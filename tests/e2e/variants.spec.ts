import { expect, test, type Page } from "@playwright/test";

const replies: Record<string, string> = {
  e2e4: "e7e5",
  d2d4: "d7d5",
  c2c4: "c7c5",
  g1f3: "g8f6",
  b2b3: "b7b6",
  g2g3: "g7g6",
  a2a3: "a7a6",
};

async function playMove(page: Page, from: string, to: string) {
  const origin = page.getByRole("button", { name: new RegExp(`^${from},`) });
  await expect(
    origin,
    `Origen ${from} no se habilitó; turno/ruta: ${await page.locator('[role="status"]').allTextContents()}`,
  ).toBeEnabled({ timeout: 20_000 });
  await origin.focus();
  await page.keyboard.press("Enter");
  const destination = page.getByRole("button", {
    name: new RegExp(`^${to},.*destino legal`),
  });
  await expect(
    destination,
    `Destino ${to} no es legal tras ${from}`,
  ).toBeEnabled({ timeout: 20_000 });
  await destination.focus();
  await page.keyboard.press("Enter");
}

async function backToStart(page: Page) {
  const back = page.getByRole("button", { name: /Retroceder una jugada/ });
  for (let i = 0; i < 12; i += 1) {
    if (!(await back.isEnabled())) break;
    await back.focus();
    await page.keyboard.press("Enter");
  }
}

async function openTree(page: Page) {
  const trigger = page.getByRole("button", { name: /^(Principal|Variante)$/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Árbol de jugadas" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeTree(page: Page) {
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Árbol de jugadas" }),
  ).toHaveCount(0);
}

async function createTrial(page: Page, from: string, to: string, san: string) {
  await backToStart(page);
  await playMove(page, from, to);
  const tree = await openTree(page);
  await expect(
    tree.getByRole("button", { name: san, exact: true }).last(),
  ).toBeVisible({ timeout: 10_000 });
  await closeTree(page);
}

test.describe("variant history full matrix", () => {
  test("creates, merges, prunes, promotes and persists lines", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("**/maia3-api/move", async (route) => {
      const body = route.request().postDataJSON() as {
        id: string;
        moves?: string[];
      };
      const userMoves = (body.moves ?? []).filter(
        (_move, index) => index % 2 === 0,
      );
      const lastUserMove = userMoves[userMoves.length - 1];
      const move = (lastUserMove && replies[lastUserMove]) || "e7e5";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: body.id,
          backend: "maia3-local",
          move,
          candidates: [],
        }),
      });
    });

    await page.goto("/#/game");
    await page.getByRole("button", { name: "Comenzar partida" }).click();
    await playMove(page, "e2", "e4");
    await expect(
      page.locator(".board").getByRole("button", { name: /^e4, pieza blanca/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(".board").getByRole("button", { name: /^e5, pieza negra/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Replay the same continuation from the root; it must merge with main.
    await backToStart(page);
    await playMove(page, "e2", "e4");
    const initialTree = await openTree(page);
    await expect(
      initialTree.getByText("Historial de variantes", { exact: true }),
    ).toBeVisible();
    await closeTree(page);
    const trialMoves: [string, string, string][] = [
      ["d2", "d4", "d4"],
      ["c2", "c4", "c4"],
      ["g1", "f3", "Nf3"],
      ["b2", "b3", "b3"],
      ["g2", "g3", "g3"],
    ];
    for (const [from, to, san] of trialMoves)
      await createTrial(page, from, to, san);

    // Sixth trial (a3/a6) prunes the oldest variant and leaves no orphan lines.
    await createTrial(page, "a2", "a3", "a3");
    const historyDialog = await openTree(page);
    const history = historyDialog.locator(".variation-line");
    test.info().attach("history-debug", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          saved: localStorage.getItem("chess-coach:active-game:v1"),
        })),
      ),
      contentType: "application/json",
    });
    await expect(history).toHaveCount(6);
    // Main e4/e5 remains; the oldest non-main trial (d4/d5) is pruned.
    await expect(
      historyDialog.locator(".variation-moves").filter({ hasText: "d4" }),
    ).toHaveCount(0);

    // Continue b3/b6 from its active line: two plies beyond main auto-promote it.
    await historyDialog
      .getByRole("button", { name: "b3", exact: true })
      .click();
    const continuationDialog = await openTree(page);
    await continuationDialog
      .getByRole("button", { name: "b6", exact: true })
      .click();
    await closeTree(page);
    await playMove(page, "g1", "f3");
    await expect(page.locator(".mobile-tree-toggle")).toHaveText("Principal");
    const promotedDialog = await openTree(page);
    await expect(
      promotedDialog.locator(".variation-moves").filter({ hasText: "b3" }),
    ).toHaveCount(1);
    await closeTree(page);

    // Selection by keyboard and arrows keeps the selected route/cursor.
    const selectionDialog = await openTree(page);
    const c4 = selectionDialog
      .getByRole("button", { name: "c4", exact: true })
      .first();
    await c4.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await closeTree(page);

    const savedBeforeReload = await page.evaluate(() =>
      localStorage.getItem("chess-coach:active-game:v1"),
    );
    expect(savedBeforeReload).toContain("activeLineId");
    await page.reload();
    const reloadedTree = await openTree(page);
    await expect(
      reloadedTree.getByText("Historial de variantes", { exact: true }),
    ).toBeVisible();
    // Promotion removes the former main; the promoted line plus four variants remain.
    await expect(reloadedTree.locator(".variation-line")).toHaveCount(5);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await closeTree(page);
    await backToStart(page);
    await playMove(page, "c2", "c4");

    // Touch-friendly deletion dialog: opening and cancelling must be usable on narrow viewports.
    const deleteDialog = await openTree(page);
    const deleteButton = deleteDialog
      .getByRole("button", { name: "Eliminar variante" })
      .last();
    if (await deleteButton.count()) {
      await deleteButton.click();
      await expect(
        page.getByRole("dialog", { name: "¿Eliminar esta variante?" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancelar" }).click();
    }
    expect(consoleErrors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
