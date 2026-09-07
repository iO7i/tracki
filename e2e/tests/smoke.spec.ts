import { expect, test } from "@playwright/test";

const unique = Date.now();

test("arabic is the default locale and the landing page renders RTL", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  // The public landing page (not a redirect to login) — brand + a start CTA.
  // Exact: "Tracki Mobile" now also lives in the products dropdown (implementation).
  await expect(page.getByRole("navigation").getByText("Tracki", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "ابدأ مجاناً" }).first()).toBeVisible();
});

test("signup → create org → create project → snippet tag visible (EN)", async ({ page }) => {
  await page.goto("/en/signup");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await page.getByLabel("Name").fill("Demo Owner");
  await page.getByLabel("Email").fill(`owner+${unique}@demo.sa`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/en\/orgs/);

  await page.getByLabel("Organization name").fill(`Demo Bank ${unique}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/orgs/demo-bank-${unique}`));

  await page.getByLabel("Project name").fill("Main website");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/orgs/demo-bank-${unique}/projects/main-website`));

  const snippet = page.locator("code");
  await expect(snippet).toContainText('data-key="pk_');
  await expect(snippet).toContainText("<script async");
});

test("locale switcher flips direction", async ({ page }) => {
  await page.goto("/en/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/login/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
