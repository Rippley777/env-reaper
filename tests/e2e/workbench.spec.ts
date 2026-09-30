import { test, expect } from "@playwright/test";
test("overview, inventory search, inspector, and command palette", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Repository overview" }),
  ).toBeVisible();
  await expect(page.getByText("DEMO DATA")).toBeVisible();
  await page.getByRole("button", { name: "Explore all variables" }).click();
  await page
    .getByRole("textbox", { name: "Search variables" })
    .fill("DATABASE_URL");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("row", { name: "Inspect DATABASE_URL" }).click();
  await expect(
    page.getByRole("dialog", { name: "Variable DATABASE_URL" }),
  ).toBeVisible();
  await expect(
    page.getByText("Connection string", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "What are we unearthing?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show missing variables" }).click();
  await expect(
    page.getByRole("heading", { name: "Missing souls", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  expect(errors).toEqual([]);
});
test("drift, graph, generation preview, downloads and rescan", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Configuration drift", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Only show drift" }).check();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await page.getByRole("button", { name: "Env graph", exact: true }).click();
  await page.getByLabel("Graph variable").selectOption("REDIS_URL");
  await expect(page.locator(".variable-node")).toContainText("REDIS_URL");
  await page.getByRole("button", { name: "Variables", exact: true }).click();
  await page.getByRole("button", { name: "Generate .env.example" }).click();
  await expect(page.locator(".code-preview")).toContainText("DATABASE_URL=\n");
  await page.getByRole("button", { name: "Review download" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^\.?env\.example$/);
  await page.getByRole("button", { name: "Reap project" }).click();
  await expect(page.getByRole("button", { name: "Scanning…" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Demo scan complete");
});
test("browser directory import stays local and masks values", async ({
  page,
}) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "envreaper-test-"));
  try {
    await fs.writeFile(
      path.join(dir, ".env.local"),
      "DATABASE_URL=postgres://user:never-show-this@localhost/db\nDEAD_VAR=old",
    );
    await fs.writeFile(
      path.join(dir, "app.ts"),
      "process.env.DATABASE_URL; process.env.MISSING_VAR",
    );
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles(dir);
    await expect(
      page.getByRole("heading", { name: "Repository overview" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "Scanned 2 files locally",
    );
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await page.getByRole("row", { name: "Inspect DATABASE_URL" }).click();
    await expect(page.getByText("Git status unknown")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain(
      "never-show-this",
    );
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain("never-show-this");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("small screens do not overflow the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Repository overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/env-reaper-mobile.png", fullPage: true });
});
