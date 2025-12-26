const { chromium } = require('playwright');

(async () => {
  const url = 'http://localhost:3000/stitch/command-center-latest';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });

  const out = await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    const doc = iframe?.contentDocument;
    const card = doc?.querySelector('[class*="max-w-[1024px]"]');

    const r = card?.getBoundingClientRect();
    const cs = card ? doc.defaultView.getComputedStyle(card) : null;

    return {
      iframe: iframe ? iframe.getBoundingClientRect().toJSON?.() ?? iframe.getBoundingClientRect() : null,
      card: card ? {
        w: Math.round(r.width),
        h: Math.round(r.height),
        maxWidth: cs.maxWidth,
        width: cs.width,
      } : null,
    };
  });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
