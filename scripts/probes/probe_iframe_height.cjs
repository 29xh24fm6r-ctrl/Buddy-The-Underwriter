const { chromium } = require('playwright');

(async () => {
  const url = 'http://localhost:3000/stitch/command-center-latest';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });

  // Give the bridge a moment to post + apply height
  await page.waitForTimeout(1200);

  const out = await page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    if (!iframe) return { ok: false, reason: "no iframe" };
    return {
      ok: true,
      styleHeight: iframe.getAttribute("style"),
      computedHeight: getComputedStyle(iframe).height,
    };
  });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
