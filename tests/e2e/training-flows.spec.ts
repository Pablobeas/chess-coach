import { expect, test } from "@playwright/test";

async function move(
  page: import("@playwright/test").Page,
  from: string,
  to: string,
) {
  await page.getByRole("gridcell", { name: new RegExp(`^${from},`) }).click();
  await page.getByRole("gridcell", { name: new RegExp(`^${to},`) }).click();
}

async function selectTraining(
  page: import("@playwright/test").Page,
  label: string,
  option: string,
) {
  await page.getByRole("button", { name: new RegExp(`^${label} `) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("training routes and interactive opening lessons", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/");
    await page.evaluate(() => localStorage.clear());
  });

  test("opening catalog supports manual lines, navigation, switching and non-Italian practice", async ({
    page,
  }) => {
    await page.goto("/#/openings");
    await expect(
      page.getByRole("heading", { name: "Aperturas" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Apertura / }).click();
    await expect(page.getByRole("option")).toHaveCount(5);
    for (const name of [
      "Apertura Italiana · C50",
      "Apertura Espanola (Ruy Lopez) · C70",
      "Defensa Siciliana: linea abierta basica · B90",
      "Defensa Francesa: linea clasica basica · C14",
      "Gambito de Dama Declinado: linea basica · D55",
    ])
      await expect(
        page.getByRole("option", { name, exact: true }),
      ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".training-arrow-player")).not.toHaveCount(0);
    await expect(page.locator(".training-arrow-opponent")).not.toHaveCount(0);
    await move(page, "e2", "e3");
    await expect(page.getByRole("status")).toContainText(
      /no es el movimiento/i,
    );
    await expect(
      page.getByRole("gridcell", { name: /^e2, pieza blanca/ }),
    ).toBeVisible();
    await move(page, "e2", "e4");
    await move(page, "e7", "e5");
    await expect(page.getByText("Paso 2 de")).toBeVisible();
    await page.getByRole("button", { name: /Paso siguiente/ }).click();
    await expect(page.getByText("Paso 3 de")).toBeVisible();
    await page.getByRole("button", { name: /Paso anterior/ }).click();
    await expect(page.getByText("Paso 2 de")).toBeVisible();
    await expect(
      page.getByRole("gridcell", { name: /^g1, pieza blanca/ }),
    ).toBeVisible();
    await selectTraining(
      page,
      "Apertura",
      "Apertura Espanola (Ruy Lopez) · C70",
    );
    await move(page, "e2", "e4");
    await move(page, "e7", "e5");
    await expect(page.getByText("Paso 2 de")).toBeVisible();
    await selectTraining(
      page,
      "Apertura",
      "Defensa Siciliana: linea abierta basica · B90",
    );
    await selectTraining(page, "Modo", "Práctica");
    await expect(
      page.getByRole("heading", { name: "Práctica guiada" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Apertura Defensa Siciliana/ }),
    ).toBeVisible();
  });

  test("the single Más menu exposes mobile controls, captures and actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/game");
    await page.getByRole("button", { name: "Comenzar partida" }).click();
    const menu = page.locator("details.utility-menu");
    await expect(menu).toHaveCount(1);
    const summary = menu.locator("summary");
    await expect(summary).toContainText("Más");
    await summary.click();
    await expect(menu).toHaveAttribute("open", "");
    await expect(
      menu.locator(".utility-menu-captures .captured-tray"),
    ).toHaveCount(2);
    const evaluation = menu.getByLabel("Mostrar evaluación");
    await expect(evaluation).toBeVisible();
    await expect(
      menu.getByLabel("Mostrar flecha de última jugada"),
    ).toBeVisible();
    for (const name of [
      "Reiniciar partida",
      "Exportar PGN",
      "Abandonar partida",
    ])
      await expect(menu.getByRole("button", { name })).toBeVisible();
    await expect(menu.getByText("Importar PGN")).toBeVisible();
    await evaluation.click();
    await expect(evaluation).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
  });
});
