import { expect, test } from "@playwright/test";

test("desktop preserves full feedback while keeping the board visible", async ({
  page,
}) => {
  await page.route("**/maia3-api/move", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { id?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: body.id ?? "desktop-e2e",
        backend: "maia3-local",
        move: "e7e5",
        candidates: [],
      }),
    });
  });
  await page.goto("/#/game");
  await page.getByRole("button", { name: "Comenzar partida" }).click();
  await page.getByRole("button", { name: /^e2,/ }).click();
  await page.getByRole("button", { name: /^e4,.*destino legal/ }).click();

  await expect(page.locator(".feedback-ready")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".feedback-ready-content")).toBeVisible();
  await expect(page.locator(".board")).toBeVisible();
  const summary = (await page.locator(".feedback-copy").textContent()) ?? "";
  expect(summary.length).toBeGreaterThan(0);
  expect(summary).not.toMatch(/PV|centipe?on|depth|multipv|confianza/i);

  await page.getByRole("button", { name: /Ver explicaci/ }).click();
  const dialog = page.getByRole("dialog", { name: /An.*lisis de/ });
  await expect(dialog).toBeVisible();
  const detail = (await dialog.locator("p").first().textContent()) ?? "";
  expect(detail.length).toBeGreaterThan(0);
  expect(detail).not.toBe(summary);
  expect(detail).not.toMatch(/PV|centipe?on|depth|multipv|confianza/i);

  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    boardWidth:
      document.querySelector<HTMLElement>(".board")?.getBoundingClientRect()
        .width ?? 0,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
  expect(layout.boardWidth).toBeGreaterThan(400);
});
