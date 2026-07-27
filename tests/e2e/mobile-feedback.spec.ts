import { expect, test, type Page } from "@playwright/test";

const opponentMoves: Record<string, string> = {
  e2e4: "e7e5",
  d2d4: "d7d5",
  c2c4: "c7c5",
};

async function playMove(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: new RegExp(`^${from},`) }).click();
  await page
    .getByRole("button", { name: new RegExp(`^${to},.*destino legal`) })
    .click();
}

async function start(page: Page) {
  await page.goto("/#/game");
  const begin = page.getByRole("button", { name: "Comenzar partida" });
  if (await begin.count()) await begin.click();
}

function installMaiaMock(page: Page, delayMs = 0) {
  return page.route("**/maia3-api/move", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      id?: string;
      moves?: string[];
    };
    const moves = body.moves ?? [];
    const userMove = moves.filter((_move, index) => index % 2 === 0).at(-1);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: body.id ?? "e2e",
        backend: "maia3-local",
        move: opponentMoves[userMove ?? ""] ?? "e7e5",
        candidates: [],
      }),
    });
  });
}

async function moveButton(page: Page, san: string) {
  return page.getByRole("button", { name: new RegExp(`^${san}(,|$)`) }).last();
}

function terminalCoachFeedback(page: Page) {
  return page
    .getByRole("button", { name: /Abrir análisis de/ })
    .or(page.getByRole("button", { name: "Reintentar análisis" }));
}

test.describe("mobile fixed game and coach feedback", () => {
  test.describe.configure({ mode: "serial" });

  test("new game remains naturally scrollable when mobile browser chrome changes", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/#/game");
    const configuredViewport = test.info().project.use.viewport as
      { width?: number } | undefined;
    if (configuredViewport?.width === 390) {
      await page.setViewportSize({ width: 390, height: 710 });
    }
    await page.evaluate(() =>
      window.visualViewport?.dispatchEvent(new Event("resize")),
    );
    const expectedViewportHeight = await page.evaluate(() =>
      Math.round(window.visualViewport?.height ?? window.innerHeight),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            "--app-viewport-height",
          ),
        ),
      )
      .toBe(`${expectedViewportHeight}px`);

    const startButton = page.getByRole("button", { name: "Comenzar partida" });
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      optionHeights: [
        ...document.querySelectorAll<HTMLElement>(
          ".setup-form label:has(input)",
        ),
      ].map((element) => element.getBoundingClientRect().height),
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.viewportHeight);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.optionHeights.every((height) => height >= 44)).toBe(true);

    await startButton.scrollIntoViewIfNeeded();
    await expect(startButton).toBeVisible();
    const buttonBounds = await startButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      };
    });
    expect(buttonBounds.top).toBeGreaterThanOrEqual(0);
    expect(buttonBounds.bottom).toBeLessThanOrEqual(
      buttonBounds.viewportHeight,
    );

    await page.getByLabel("Blancas").focus();
    const focusBounds = await page.getByLabel("Blancas").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        outline: getComputedStyle(element).outlineStyle,
      };
    });
    expect(focusBounds.outline).toBe("solid");
    expect(focusBounds.top).toBeGreaterThanOrEqual(0);
    expect(focusBounds.bottom).toBeLessThanOrEqual(buttonBounds.viewportHeight);

    if (configuredViewport?.width === 320) {
      // A 160px CSS viewport is the reflow width a 320px phone exposes at 200% zoom.
      await page.setViewportSize({ width: 160, height: 568 });
      const zoomMetrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(zoomMetrics.scrollWidth).toBeLessThanOrEqual(
        zoomMetrics.innerWidth + 1,
      );
      await startButton.scrollIntoViewIfNeeded();
      await expect(startButton).toBeVisible();
    }
  });

  test("rival may answer first; coach settles without a pending deadlock", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on(
      "console",
      (message) =>
        message.type() === "error" && consoleErrors.push(message.text()),
    );
    await installMaiaMock(page, 1_500);
    await start(page);
    await playMove(page, "e2", "e4");

    // The opponent response is allowed to arrive while the coach is still queued.
    await expect(await moveButton(page, "e4")).toBeVisible({ timeout: 20_000 });
    await expect(await moveButton(page, "e5")).toBeVisible({ timeout: 20_000 });
    await expect(terminalCoachFeedback(page)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText("Estoy revisando esa decisión…", { exact: true }),
    ).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });

  test("unavailable analysis exposes retry and retry does not rewrite history", async ({
    page,
  }) => {
    await page.route("**/stockfish/**", (route) => route.abort("failed"));
    await installMaiaMock(page);
    await start(page);
    await playMove(page, "e2", "e4");
    await expect(
      page.getByRole("heading", { name: "No pude terminar este análisis" }),
    ).toBeVisible({ timeout: 20_000 });
    const before = await page.evaluate(() =>
      localStorage.getItem("chess-coach:active-game:v1"),
    );
    await page.getByRole("button", { name: "Reintentar análisis" }).click();
    await expect(
      page.getByRole("heading", {
        name: /Estoy revisando esa decisión|No pude terminar este análisis/,
      }),
    ).toBeVisible({ timeout: 2_000 });
    const after = await page.evaluate(() =>
      localStorage.getItem("chess-coach:active-game:v1"),
    );
    const beforeWorkspace = before ? JSON.parse(before).workspace : null;
    const afterWorkspace = after ? JSON.parse(after).workspace : null;
    expect(
      afterWorkspace.lines.map(
        (line: { timeline: { session: { history: unknown[] } } }) =>
          line.timeline.session.history.length,
      ),
    ).toEqual(
      beforeWorkspace.lines.map(
        (line: { timeline: { session: { history: unknown[] } } }) =>
          line.timeline.session.history.length,
      ),
    );
  });

  test("mobile dialogs, tree, keyboard and layout remain usable", async ({
    page,
  }) => {
    await installMaiaMock(page);
    await start(page);
    await playMove(page, "e2", "e4");
    await expect(page.locator(".feedback-ready")).toBeVisible({
      timeout: 20_000,
    });

    const detail = page.getByRole("button", { name: /Abrir análisis de/ });
    await expect(detail).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ver variante" }),
    ).toBeHidden();
    await detail.click();
    await expect(
      page.getByRole("dialog", { name: /Análisis de/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog", { name: /Análisis de/ })
        .getByRole("button", { name: "Cerrar" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Análisis de/ })).toHaveCount(
      0,
    );
    await expect(detail).toBeFocused();
    const treeTrigger = page.getByRole("button", {
      name: /^(Principal|Variante)$/,
    });
    await page.waitForTimeout(750);
    await treeTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Árbol de jugadas" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog", { name: "Árbol de jugadas" })
        .getByRole("button", { name: "Cerrar" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Árbol de jugadas" }),
    ).toHaveCount(0);
    await expect(treeTrigger).toBeFocused();

    const evaluation = page.locator(".mobile-evaluation");
    const moreTrigger = page.locator(".mobile-more-toggle");
    await moreTrigger.focus();
    await page.keyboard.press("Enter");
    const moreDialog = page.getByRole("dialog", { name: "Más acciones" });
    await expect(moreDialog).toBeVisible();
    await expect(
      moreDialog.getByRole("button", { name: "Cerrar" }),
    ).toBeFocused();
    await expect(moreDialog.getByLabel("Capturas actuales")).toBeVisible();
    await expect(moreDialog).toContainText("Exportar PGN");
    await expect(moreDialog).toContainText("Reiniciar partida");
    await expect(moreDialog).toContainText("Abandonar partida");
    await expect(moreDialog).toContainText("Ajustes visibles");
    const evaluationToggle = moreDialog.getByLabel("Mostrar evaluación");
    if (await evaluationToggle.isChecked()) await evaluationToggle.uncheck();
    await expect(evaluation).toHaveCount(0);
    await evaluationToggle.check();
    await expect(evaluation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(moreDialog).toHaveCount(0);
    await expect(moreTrigger).toBeFocused();

    const back = page.getByRole("button", { name: /Retroceder una jugada/ });
    await back.focus();
    await page.keyboard.press("ArrowRight");
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      squares: [...document.querySelectorAll(".square")].map((el) =>
        Math.min(
          el.getBoundingClientRect().width,
          el.getBoundingClientRect().height,
        ),
      ),
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.squares.every((size) => size >= 32)).toBe(true);
  });

  test("ready feedback stays compact without hiding the mobile game dock", async ({
    page,
  }) => {
    await installMaiaMock(page);
    await start(page);
    await playMove(page, "e2", "e4");
    await expect(page.locator(".feedback-ready")).toBeVisible({
      timeout: 20_000,
    });
    const configuredViewport = test.info().project.use.viewport as
      { width?: number } | undefined;
    if (configuredViewport?.width === 390) {
      await page.setViewportSize({ width: 390, height: 710 });
      await page.evaluate(() =>
        window.visualViewport?.dispatchEvent(new Event("resize")),
      );
    }

    const summary = page.getByRole("button", { name: /Abrir análisis de/ });
    await expect(summary).toBeVisible();
    const summaryName = await summary.getAttribute("aria-label");
    expect(summaryName).toMatch(
      /e4.*(Mejor jugada|Excelente|Buena|Error|Imprecisi|Oportunidad|PosiciÃ³n)/i,
    );
    expect(summaryName).toMatch(
      /(Hay varias jugadas|No hay una pÃ©rdida|amenaza|material|desarrollo|enroque|alternativa|mejora)/i,
    );
    expect(summaryName).not.toMatch(/PV|centipe?Ã³n|depth|multipv|confianza/i);
    await summary.click();
    const detailDialog = page.getByRole("dialog", { name: /An.*lisis de/ });
    await expect(detailDialog).toBeVisible();
    const detailText =
      (await detailDialog.locator("p").first().textContent()) ?? "";
    expect(detailText.length).toBeGreaterThan(0);
    expect(detailText).not.toBe(summaryName);
    expect(detailText).not.toMatch(/PV|centipe?Ã³n|depth|multipv|confianza/i);
    await page.keyboard.press("Escape");
    await expect(detailDialog).toHaveCount(0);
    const metrics = await page.evaluate(() => {
      const viewportHeight =
        window.visualViewport?.height ?? window.innerHeight;
      const selectors = [
        ".game-header",
        ".mobile-evaluation",
        ".feedback-mobile-summary",
        ".board",
        ".mobile-tree-toggle",
        ".history-controls",
        ".pause-button",
        ".mobile-more-toggle",
      ];
      return {
        viewportHeight,
        scrollHeight: document.documentElement.scrollHeight,
        feedbackHeight: document
          .querySelector<HTMLElement>(".feedback-ready")
          ?.getBoundingClientRect().height,
        hiddenDesktopActions: !document
          .querySelector<HTMLElement>(".feedback-ready-content")
          ?.getClientRects().length,
        required: selectors.map((selector) => {
          const rect = document
            .querySelector<HTMLElement>(selector)
            ?.getBoundingClientRect();
          return { selector, top: rect?.top ?? -1, bottom: rect?.bottom ?? -1 };
        }),
      };
    });
    expect(metrics.feedbackHeight).toBeLessThanOrEqual(72);
    expect(metrics.hiddenDesktopActions).toBe(true);
    if (configuredViewport?.width === 390) {
      expect(metrics.scrollHeight).toBeLessThanOrEqual(
        metrics.viewportHeight + 1,
      );
      for (const item of metrics.required) {
        expect(item.top, item.selector).toBeGreaterThanOrEqual(0);
        expect(item.bottom, item.selector).toBeLessThanOrEqual(
          metrics.viewportHeight + 1,
        );
      }
    }
  });

  test("long mobile feedback summary truncates while the dialog keeps full text", async ({
    page,
  }) => {
    test.skip(
      (test.info().project.use.viewport as { width?: number } | undefined)
        ?.width !== 320,
      "Long-copy fixture targets the narrow mobile viewport",
    );
    await installMaiaMock(page);
    await start(page);
    await playMove(page, "e2", "e4");
    const summary = page.getByRole("button", { name: /Abrir análisis de/ });
    await expect(summary).toBeVisible({
      timeout: 20_000,
    });
    const fullCopy = (await page.locator(".feedback-copy").textContent()) ?? "";
    expect(fullCopy.length).toBeGreaterThan(0);
    const metrics = await summary.evaluate((element) => {
      const reason = element.querySelector("span:last-child");
      if (!reason) throw new Error("Missing compact feedback reason");
      reason.textContent = Array.from(
        { length: 80 },
        () =>
          "Una explicación larga de prueba para comprobar el recorte accesible.",
      ).join(" ");
      const board = document
        .querySelector<HTMLElement>(".board")
        ?.getBoundingClientRect();
      return {
        summaryHeight: element.getBoundingClientRect().height,
        reasonClientWidth: reason.clientWidth,
        reasonScrollWidth: reason.scrollWidth,
        boardWidth: board?.width ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(metrics.summaryHeight).toBeLessThanOrEqual(72);
    expect(metrics.reasonScrollWidth).toBeGreaterThan(
      metrics.reasonClientWidth,
    );
    expect(metrics.boardWidth).toBeGreaterThanOrEqual(280);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    await summary.click();
    const detailDialog = page.getByRole("dialog");
    const detailCopy =
      (await detailDialog.locator("p").first().textContent()) ?? "";
    expect(detailCopy.length).toBeGreaterThan(0);
    expect(detailCopy).not.toBe(fullCopy);
    expect(detailCopy).toMatch(/e2-e4|mover/i);
  });

  test("a reduced Safari visual viewport keeps the game controls in view", async ({
    page,
  }) => {
    test.skip(
      (test.info().project.use.viewport as { width?: number } | undefined)
        ?.width !== 390,
      "The Safari browser-chrome regression targets a 390px phone",
    );
    await start(page);
    await page.setViewportSize({ width: 390, height: 710 });
    await page.evaluate(() =>
      window.visualViewport?.dispatchEvent(new Event("resize")),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            "--app-viewport-height",
          ),
        ),
      )
      .toBe("710px");

    const metrics = await page.evaluate(() => {
      const viewportHeight =
        window.visualViewport?.height ?? window.innerHeight;
      const required = [
        ".game-header",
        ".mobile-evaluation",
        ".feedback",
        ".board",
        ".mobile-tree-toggle",
        ".history-controls",
        ".pause-button",
        ".mobile-more-toggle",
      ].map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        const rect = element?.getBoundingClientRect();
        return {
          selector,
          visible: Boolean(rect && rect.width > 0 && rect.height > 0),
          top: rect?.top ?? Number.POSITIVE_INFINITY,
          bottom: rect?.bottom ?? Number.NEGATIVE_INFINITY,
        };
      });
      return {
        viewportHeight,
        scrollHeight: document.documentElement.scrollHeight,
        required,
      };
    });

    expect(metrics.scrollHeight).toBeLessThanOrEqual(
      metrics.viewportHeight + 1,
    );
    for (const control of metrics.required) {
      expect(control.visible, control.selector).toBe(true);
      expect(control.top, control.selector).toBeGreaterThanOrEqual(0);
      expect(control.bottom, control.selector).toBeLessThanOrEqual(
        metrics.viewportHeight + 1,
      );
    }
  });

  test("short mobile viewports retain every control through document scroll", async ({
    page,
  }) => {
    const viewport = test.info().project.use.viewport as
      { width?: number; height?: number } | undefined;
    test.skip(
      !viewport?.height || viewport.height > 620,
      "This regression covers the documented short-height fallback",
    );
    await start(page);

    const selectors = [
      ".game-header",
      ".feedback",
      ".board",
      ".mobile-tree-toggle",
      ".history-controls",
      ".pause-button",
      ".mobile-more-toggle",
    ];
    const before = await page.evaluate(() => ({
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    // Portrait 320×568 needs scrolling; landscape can fit its two-column
    // fallback without it. In both cases content must never be clipped.
    expect(before.scrollHeight).toBeGreaterThanOrEqual(before.viewportHeight);
    expect(before.scrollWidth).toBeLessThanOrEqual(before.innerWidth + 1);

    for (const selector of selectors) {
      const rect = await page.locator(selector).evaluate((element) => {
        element.scrollIntoView({ block: "nearest" });
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
      expect(rect.width, selector).toBeGreaterThan(0);
      expect(rect.height, selector).toBeGreaterThan(0);
    }
  });
});
