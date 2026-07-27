import { expect, test, type Page } from "@playwright/test";
import { loadPgn } from "../../packages/chess-core/src/index";

const STORAGE_KEY = "chess-coach:active-game:v1";
const FOOLS_MATE = "1. f3 e5 2. g4 Qh4#";
const SCHOLAR_MATE = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#";
const SCHOLAR_PREMATE = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6";

type PlayerColor = "white" | "black";

function storedTerminalGame(
  pgn: string,
  playerColor: PlayerColor,
  withDecoy = false,
  cursor = loadPgn(pgn).history.length,
) {
  const session = loadPgn(pgn);
  const decoy = loadPgn("1. d4 d5 2. c4 e6");
  const lines = [
    {
      id: "main",
      timeline: { session, cursor },
      annotations: [],
      feedbackByPly: [],
      revision: 0,
    },
    ...(withDecoy
      ? [
          {
            id: "trial-decoy",
            timeline: { session: decoy, cursor: decoy.history.length },
            annotations: [],
            feedbackByPly: [],
            fork: { lineId: "main", ply: 0 },
            revision: 0,
          },
        ]
      : []),
  ];
  const workspace = {
    version: 6 as const,
    mainLineId: "main",
    activeLineId: "main",
    lines,
    revision: 0,
  };
  return {
    version: 6 as const,
    settings: {
      playerColor,
      opponentElo: 1500,
      enginePreset: "beginner" as const,
      helpLevel: "normal" as const,
      showEvaluation: true,
      showArrows: true,
    },
    workspace,
    session,
    cursor,
    annotations: [],
    feedbackByPly: [],
    savedAt: new Date(0).toISOString(),
  };
}

async function openSeededReview(
  page: Page,
  pgn = FOOLS_MATE,
  playerColor: PlayerColor = "white",
  withDecoy = false,
  cursor?: number,
) {
  const stored = storedTerminalGame(pgn, playerColor, withDecoy, cursor);
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: stored },
  );
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Resumen final" });
  await expect(dialog).toBeVisible({ timeout: 12_000 });
  return dialog;
}

async function openSeededPosition(
  page: Page,
  pgn: string,
  cursor = loadPgn(pgn).history.length,
) {
  const stored = storedTerminalGame(pgn, "white", false, cursor);
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: stored },
  );
  await page.goto("/");
  await expect(page.locator(".board")).toBeVisible();
}

function reviewMoves(dialog: ReturnType<Page["getByRole"]>) {
  return dialog.locator(".postgame-moves li");
}

test.describe("postgame review", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Keep the seeded workspace across an explicit reload in persistence
      // tests, while still isolating each fresh browser context.
      if (!sessionStorage.getItem("postgame-e2e-initialized")) {
        localStorage.clear();
        sessionStorage.setItem("postgame-e2e-initialized", "1");
      }
    });
  });

  test("does not auto-open before the exact terminal cursor", async ({
    page,
  }) => {
    const stored = storedTerminalGame(FOOLS_MATE, "white", false, 3);
    await page.addInitScript(
      ({ key, value }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(value));
      },
      { key: STORAGE_KEY, value: stored },
    );
    await page.goto("/");
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver resumen" })).toHaveCount(
      0,
    );
  });

  async function playScholarMateFromPreMate(
    page: Page,
    reducedMotion: boolean,
  ) {
    if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
    await openSeededPosition(page, SCHOLAR_PREMATE);
    await page.getByRole("button", { name: /^h5,/ }).click();
    await page.evaluate(() => {
      const state = window as Window & {
        __mateAppliedAt?: number;
        __reviewOpenedAt?: number;
      };
      state.__mateAppliedAt = undefined;
      state.__reviewOpenedAt = undefined;
      new MutationObserver(() => {
        if (
          state.__mateAppliedAt === undefined &&
          document
            .querySelector<HTMLElement>(".board")
            ?.getAttribute("aria-label")
            ?.includes("jaque mate")
        )
          state.__mateAppliedAt = performance.now();
        if (
          state.__mateAppliedAt !== undefined &&
          state.__reviewOpenedAt === undefined &&
          document.querySelector(
            '[role="dialog"][aria-labelledby="postgame-review-title"]',
          )
        )
          state.__reviewOpenedAt = performance.now();
      }).observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    });
    await page.getByRole("button", { name: /^f7,.*destino legal/ }).click();
    const dialog = page.getByRole("dialog", { name: "Resumen final" });
    await expect(dialog).toBeVisible({ timeout: 1_000 });
    return page.evaluate(() => {
      const state = window as Window & {
        __mateAppliedAt?: number;
        __reviewOpenedAt?: number;
      };
      if (
        state.__mateAppliedAt === undefined ||
        state.__reviewOpenedAt === undefined
      )
        return Number.POSITIVE_INFINITY;
      return state.__reviewOpenedAt - state.__mateAppliedAt;
    });
  }

  test("opens the review immediately after a user mate from the board", async ({
    page,
  }) => {
    // The measurement spans the two React commits after mate, not engine work.
    // Cross-browser scheduling needs a 1.5 s upper bound while preserving the
    // real elapsed-time assertion.
    expect(await playScholarMateFromPreMate(page, false)).toBeLessThan(1_500);
  });

  test("opens the review within the reduced-motion budget", async ({
    page,
  }) => {
    // Reduced motion removes the intentional 370 ms piece animation; the
    // 1-second bound absorbs React/WebKit scheduling without awaiting analysis.
    expect(await playScholarMateFromPreMate(page, true)).toBeLessThan(1_000);
  });

  test("opens only at terminal cursor, reports a loss, and shows final SAN only", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page, FOOLS_MATE, "white", true);
    await expect(dialog.locator("#postgame-review-title")).toBeFocused();
    await expect(dialog.getByText("Derrota por jaque mate")).toBeVisible();
    await expect(dialog.getByText("Ganan negras.")).toBeVisible();
    await expect(dialog.getByText("Recorrido de la partida")).toBeVisible();
    await expect(dialog.locator('svg[role="img"]')).toHaveAttribute(
      "aria-label",
      /jaque mate/,
    );
    await expect(dialog.locator(".postgame-moves li")).toHaveText([
      "1. f3",
      "1... e5",
      "2. g4",
      "2... Qh4#",
    ]);
    expect(
      (await dialog.locator(".postgame-moves li").allTextContents()).join(" "),
    ).not.toContain("d4");
    await expect(dialog.locator(".postgame-phase-card")).toHaveCount(3);
    await page.screenshot({
      path: `output/playwright/postgame-review-${test.info().project.name}.png`,
      fullPage: false,
    });
  });

  test("reports a white win and exposes both participant stability groups", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page, SCHOLAR_MATE, "white");
    await expect(dialog.getByText("Victoria por jaque mate")).toBeVisible();
    await expect(dialog.getByText("Ganan blancas.")).toBeVisible();
    await expect(dialog.locator(".postgame-participant")).toHaveCount(2);
    await expect(dialog.locator(".postgame-bucket-group")).toHaveCount(2);
    await expect(dialog.locator(".postgame-buckets dd")).toHaveCount(12);
    await expect(
      dialog.getByText(/decisiones analizadas/).first(),
    ).toBeVisible();
  });

  test("keeps partial progress grounded and resumes after reload", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page, SCHOLAR_MATE, "white");
    const progress = dialog.locator(".postgame-progress");
    await expect(progress).toContainText(
      /Estimación local (en curso|terminada|incompleta)/,
    );
    const scores = await dialog
      .locator(".postgame-participant strong")
      .allTextContents();
    expect(
      scores.every(
        (score) => score === "Datos insuficientes" || /^\d+\/100$/.test(score),
      ),
    ).toBe(true);
    const beforeReload = await page.evaluate((key) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      return stored?.workspace?.postgameReview;
    }, STORAGE_KEY);
    expect(beforeReload?.reviewId).toBeTruthy();
    await page.reload();
    const reloadedDialog = page.getByRole("dialog", { name: "Resumen final" });
    // Reload restores the review state; presentation may remain closed after
    // a prior dismissal, so reopen through the explicit summary affordance.
    if (!(await reloadedDialog.isVisible())) {
      await page.getByRole("button", { name: "Ver resumen" }).click();
    }
    await expect(reloadedDialog).toBeVisible({ timeout: 12_000 });
    await expect(reloadedDialog.locator(".postgame-progress")).toBeVisible();
    const afterReload = await page.evaluate((key) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      return stored?.workspace?.postgameReview;
    }, STORAGE_KEY);
    expect(afterReload?.reviewId).toBe(beforeReload.reviewId);
    expect(afterReload?.progress.completed).toBeGreaterThanOrEqual(
      beforeReload.progress.completed,
    );
  });

  test("close stays closed through updates, Escape restores focus, and summary reopens", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page);
    const close = dialog
      .getByRole("button", { name: "Volver al tablero" })
      .first();
    await close.click();
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toBeHidden();
    await page.waitForTimeout(500);
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toBeHidden();
    const summary = page.getByRole("button", { name: "Ver resumen" });
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toBeHidden();
    await expect(summary).toBeFocused();
  });

  test("Nueva partida clears terminal review and keeps the board usable", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page);
    await dialog.getByRole("button", { name: "Nueva partida" }).click();
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toBeHidden();
    await expect(page.getByRole("button", { name: "Ver resumen" })).toHaveCount(
      0,
    );
    await expect(page.locator(".board")).toBeVisible();
    await expect
      .poll(
        async () =>
          JSON.parse(
            (await page.evaluate(
              (key) => localStorage.getItem(key),
              STORAGE_KEY,
            )) ?? "null",
          )?.workspace?.postgameReview,
      )
      .toBeUndefined();
  });

  test("phase cards expose reached or unavailable states without invented scores", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page);
    const phaseText = await dialog
      .locator(".postgame-phase-card")
      .allTextContents();
    expect(phaseText).toHaveLength(3);
    expect(phaseText.join(" ")).toMatch(/Apertura/);
    expect(phaseText.join(" ")).toMatch(
      /No se alcanzó|No aplicable|Datos insuficientes|decisiones analizadas/,
    );
    expect(phaseText.join(" ")).not.toMatch(
      /probabilidad|porcentaje de victoria/,
    );
  });

  test("mobile review scrolls internally and preserves board layout after close", async ({
    page,
  }) => {
    const dialog = await openSeededReview(page);
    const metrics = await page.evaluate(() => ({
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      reviewScrollHeight:
        document.querySelector<HTMLElement>(".postgame-review-scroll")
          ?.scrollHeight ?? 0,
      reviewClientHeight:
        document.querySelector<HTMLElement>(".postgame-review-scroll")
          ?.clientHeight ?? 0,
    }));
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(
      metrics.innerWidth + 1,
    );
    expect(metrics.reviewScrollHeight).toBeGreaterThanOrEqual(
      metrics.reviewClientHeight,
    );
    await dialog
      .getByRole("button", { name: "Volver al tablero" })
      .first()
      .click();
    await expect(page.locator(".board")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".board")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true);
  });

  test("analyzes every live terminal position without creating terminal feedback or ASM fallback", async ({
    page,
  }) => {
    await openSeededPosition(page, SCHOLAR_PREMATE);
    await page.getByRole("button", { name: /^h5,/ }).click();
    await page.getByRole("button", { name: /^f7,.*destino legal/ }).click();
    const dialog = page.getByRole("dialog", { name: "Resumen final" });
    await expect(dialog).toBeVisible({ timeout: 1_000 });
    await expect
      .poll(() => dialog.locator(".postgame-progress").textContent(), {
        timeout: 30_000,
      })
      .toMatch(/Estimación local terminada · 7\/7 posiciones/);
    const stored = await page.evaluate((key) => {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      return value?.workspace?.postgameReview;
    }, STORAGE_KEY);
    expect(stored?.status).toBe("ready");
    expect(stored?.progress).toEqual({ completed: 7, total: 7 });
    const finalFeedback = await page.evaluate((key) => {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      return value?.workspace?.lines
        ?.find((line: { id: string }) => line.id === "main")
        ?.feedbackByPly?.find(
          (entry: { historyIndex: number }) => entry.historyIndex === 6,
        );
    }, STORAGE_KEY);
    // The terminal position belongs to postgame review, not the live coach
    // contract. It must never leave a pending/unavailable MoveFeedback record.
    expect(finalFeedback).toBeUndefined();
    const workerUrls = page.workers().map((worker) => worker.url());
    expect(workerUrls.join(" ")).not.toMatch(/launcher.*asm|stockfish-18-asm/i);
    const reviewId = stored.reviewId;
    await page.reload();
    const reloaded = await page.evaluate((key) => {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      const review = value?.workspace?.postgameReview;
      const feedback = value?.workspace?.lines
        ?.find((line: { id: string }) => line.id === "main")
        ?.feedbackByPly?.find(
          (entry: { historyIndex: number }) => entry.historyIndex === 6,
        );
      return { review, feedback };
    }, STORAGE_KEY);
    expect(reloaded.review.reviewId).toBe(reviewId);
    expect(reloaded.review.progress.completed).toBe(7);
    expect(reloaded.feedback).toBeUndefined();
  });
});
