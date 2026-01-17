import { chromium, type FullConfig } from "@playwright/test";

export default async function globalSetup(_config: FullConfig) {
  const bootstrapUrl = process.env.SMOKE_AUTH_BOOTSTRAP_URL;
  const storagePath = process.env.SMOKE_STORAGE_STATE ?? ".playwright/storageState.json";

  if (!bootstrapUrl) {
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(bootstrapUrl, { waitUntil: "domcontentloaded" });

  await page.context().storageState({ path: storagePath });
  await browser.close();
}
