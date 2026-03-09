import { test, expect } from "@playwright/test";

test.describe("ValeDesk E2E", () => {
  test("app loads and shows main layout", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ValeDesk|valera/i);
  });

  test("sidebar is visible", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside, [role='navigation'], nav").first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
  });

  test("prompt input area exists", async ({ page }) => {
    await page.goto("/");
    const input = page.locator("textarea, input[type='text']").first();
    await expect(input).toBeVisible({ timeout: 10_000 });
  });
});
