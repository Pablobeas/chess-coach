import { expect, test } from "@playwright/test";

test.describe("training routes and persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/");
    await page.evaluate(() => localStorage.clear());
  });

  test("home exposes all training routes and menu closes by outside click/Escape", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: /Tu siguiente buena decisi/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Partida", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Men/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("button", { name: /Men/ }).click();
    await page.locator("#main-content").click({ position: { x: 8, y: 8 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("puzzle wrong move, hint, solve and progress persist", async ({
    page,
  }) => {
    await page.goto("/#/puzzles");
    await expect(page.getByRole("heading", { name: "Puzles" })).toBeVisible();
    await page.getByRole("gridcell", { name: /^g2, pieza blanca/ }).click();
    await page.getByRole("gridcell", { name: /^g3, vac/ }).click();
    await expect(page.getByRole("status")).toContainText(/no fuerza|legal/i);
    await page.getByRole("button", { name: /Pista 1/ }).click();
    await expect(page.getByRole("status")).toContainText("Busca un jaque");
    const move = async (from: string, to: string) => {
      await page
        .getByRole("gridcell", { name: new RegExp(`^${from},`) })
        .click();
      await page.getByRole("gridcell", { name: new RegExp(`^${to},`) }).click();
    };
    await move("h5", "f7");
    await move("f7", "e8");
    await expect(
      page.getByRole("heading", { name: /Ejercicio resuelto/ }),
    ).toBeVisible();
    await expect(page.getByText("1/4 completados")).toBeVisible();
    await page.reload();
    await expect(page.getByText("1/4 completados")).toBeVisible();
  });

  test("opening explanation/practice/continue and unsupported-color fallback", async ({
    page,
  }) => {
    await page.goto("/#/openings");
    await expect(
      page.getByRole("heading", { name: "Aperturas" }),
    ).toBeVisible();
    await page.getByLabel("Color").selectOption("black");
    await expect(page.getByRole("alert")).toContainText(/practica con blancas/);
    await page.getByLabel("Color").selectOption("white");
    await page.getByLabel("Modo").selectOption("practice");
    await expect(
      page.getByRole("heading", { name: "Práctica guiada" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar como partida" }).click();
    await expect(page).toHaveURL(/#\/game$/);
  });
});
