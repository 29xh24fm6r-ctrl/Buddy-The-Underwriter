import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEAL_ID = process.env.DEAL_ID;
const SNAPSHOT_ID = process.env.SNAPSHOT_ID;

if (!DEAL_ID) {
  console.error("Missing DEAL_ID. Usage: DEAL_ID=... SNAPSHOT_ID=... pnpm run capture:marketing");
  process.exit(1);
}
if (!SNAPSHOT_ID) {
  console.error("Missing SNAPSHOT_ID. Usage: DEAL_ID=... SNAPSHOT_ID=... pnpm run capture:marketing");
  process.exit(1);
}

const shots = [
  {
    name: "decision",
    url: `${BASE}/deals/${DEAL_ID}/decision?snapshot=${SNAPSHOT_ID}`,
    path: "public/marketing/decision.png",
  },
  {
    name: "replay",
    url: `${BASE}/deals/${DEAL_ID}/decision/replay?snapshot=${SNAPSHOT_ID}`,
    path: "public/marketing/replay.png",
  },
  {
    name: "overrides",
    url: `${BASE}/deals/${DEAL_ID}/decision/overrides?snapshot=${SNAPSHOT_ID}`,
    path: "public/marketing/overrides.png",
  },
];

const waitForStable = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(900); // settle animations
};

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

  for (const s of shots) {
    console.log(`Capturing: ${s.name} -> ${s.path}`);
    await page.goto(s.url, { waitUntil: "domcontentloaded" });
    await waitForStable(page);

    // Hide scrollbars for cleaner shots
    await page.addStyleTag({ content: `*::-webkit-scrollbar{display:none!important} body{overflow:hidden!important}` });
    await page.screenshot({ path: s.path, fullPage: true });
  }

  await browser.close();
  console.log("✅ Marketing screenshots captured into /public/marketing");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
