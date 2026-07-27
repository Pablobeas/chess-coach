import { expect, test, type Page } from "@playwright/test";

async function startGame(page: Page) {
  await page.goto("/#/game");
  const begin = page.getByRole("button", { name: "Comenzar partida" });
  if (await begin.count()) await begin.click();
}

async function play(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: new RegExp(`^${from},`) }).click();
  await page
    .getByRole("button", { name: new RegExp(`^${to},.*destino legal`) })
    .click();
}

async function waitForOpponentHighlight(page: Page) {
  await expect
    .poll(() => page.locator(".opponent-last-move").count(), {
      timeout: 20_000,
      message: "La respuesta rival no produjo sus dos casillas destacadas",
    })
    .toBe(2);
}

function assertHighlightPresentation(page: Page) {
  const squares = page.locator(".opponent-last-move");
  return expect
    .poll(async () => {
      const data = await squares.evaluateAll((elements) =>
        elements.map((element) => ({
          className: element.className,
          label: element.getAttribute("aria-label") ?? "",
          background: getComputedStyle(element).backgroundImage,
          border: getComputedStyle(element).boxShadow,
        })),
      );
      if (data.length !== 2) return false;
      const labels = data.map((item) => item.label);
      return (
        data.every(
          (item) =>
            item.className.includes("opponent-last-move") &&
            item.background.includes("255, 215, 61") &&
            item.border.includes("123, 87, 0"),
        ) &&
        labels.some(
          (label) =>
            label.includes("origen de la") && label.includes("jugada rival"),
        ) &&
        labels.some(
          (label) =>
            label.includes("destino de la") && label.includes("jugada rival"),
        )
      );
    })
    .toBe(true);
}

test.describe("opponent last move highlight", () => {
  test("waits before applying, exposes accessible yellow endpoints, and clears on the next user move", async ({
    page,
  }) => {
    await startGame(page);
    const startedAt = Date.now();
    await play(page, "e2", "e4");

    await page.waitForTimeout(300);
    expect(await page.locator(".opponent-last-move").count()).toBe(0);
    await waitForOpponentHighlight(page);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(450);
    await assertHighlightPresentation(page);

    await page.waitForTimeout(300);
    expect(await page.locator(".opponent-last-move").count()).toBe(2);

    await play(page, "g1", "f3");
    expect(await page.locator(".opponent-last-move").count()).toBe(0);
  });

  test("does not carry a rival highlight through history navigation", async ({
    page,
  }) => {
    await startGame(page);
    await play(page, "e2", "e4");
    await waitForOpponentHighlight(page);
    await expect(
      page.getByRole("button", { name: /Retroceder una jugada/ }),
    ).toBeEnabled();
    await page.getByRole("button", { name: /Retroceder una jugada/ }).click();
    await expect
      .poll(() => page.locator(".opponent-last-move").count())
      .toBe(0);
  });

  test("keeps the fixed board layout available on every target viewport", async ({
    page,
  }) => {
    await startGame(page);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      board: document
        .querySelector<HTMLElement>(".board")
        ?.getBoundingClientRect(),
      mobileControls: [
        ".history-controls",
        ".pause-button",
        ".mobile-more-toggle",
      ].map((selector) => ({
        selector,
        visible: Boolean(
          document.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
            .height,
        ),
      })),
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.board?.width ?? 0).toBeGreaterThan(0);
    if (metrics.innerWidth <= 720)
      expect(metrics.mobileControls.every((control) => control.visible)).toBe(
        true,
      );
  });
});
