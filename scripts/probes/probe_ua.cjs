const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/stitch/command-center-latest', { waitUntil: 'networkidle' });

  const info = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
  }));

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
