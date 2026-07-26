import { expect, test, type Page } from "@playwright/test";
import { loadPgn } from "../../packages/chess-core/src/index";

const STORAGE_KEY = "chess-coach:active-game:v1";
const FOOLS_MATE = "1. f3 e5 2. g4 Qh4#";
const SCHOLAR_MATE = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#";

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
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: stored },
  );
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Resumen final" });
  await expect(dialog).toBeVisible({ timeout: 12_000 });
  return dialog;
}

function reviewMoves(dialog: ReturnType<Page["getByRole"]>) {
  return dialog.locator(".postgame-moves li");
}

test.describe("postgame review", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("does not auto-open before the exact terminal cursor", async ({
    page,
  }) => {
    const stored = storedTerminalGame(FOOLS_MATE, "white", false, 3);
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
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
    await page.reload();
    await expect(
      page.getByRole("dialog", { name: "Resumen final" }),
    ).toBeVisible({ timeout: 12_000 });
    await expect(
      page
        .getByRole("dialog", { name: "Resumen final" })
        .locator(".postgame-progress"),
    ).toBeVisible();
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
});
