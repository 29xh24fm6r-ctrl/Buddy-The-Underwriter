import 'dotenv/config';
import http from 'node:http';
import { getPool, shutdown } from './db.js';
import { syncSbaDirectory } from './syncSbaDirectory.js';
import { scrapeWiFddBatch } from './scrapeWiFdd.js';
import { scrapeMnFddBatch } from './scrapeMnFdd.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return true;
  const authHeader = req.headers.authorization || '';
  const providedSecret = (req.headers['x-cron-secret'] as string) || '';
  if (
    providedSecret !== expectedSecret &&
    authHeader !== `Bearer ${expectedSecret}`
  ) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

function readJsonQuery(url: string | undefined): URLSearchParams {
  try {
    return new URL(url || '/', 'http://x').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];

  // Main SBA directory sync
  if (req.method === 'POST' && path === '/') {
    if (!checkAuth(req, res)) return;
    try {
      console.log('[franchise-sync-worker] SBA sync triggered');
      const pool = getPool();
      const stats = await syncSbaDirectory(pool);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[franchise-sync-worker] SBA sync failed: ${msg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }

  // Wisconsin DFI FDD scrape (batch)
  if (req.method === 'POST' && path === '/scrape-wi-fdd') {
    if (!checkAuth(req, res)) return;
    const qs = readJsonQuery(req.url);
    const batchSize = parseInt(qs.get('batchSize') || '50', 10);
    const delayMs = parseInt(qs.get('delayMs') || '2000', 10);
    const downloadPdf = qs.get('downloadPdf') !== 'false';
    const brandFilter = qs.get('brandFilter') || undefined;
    try {
      console.log(
        `[franchise-sync-worker] WI FDD scrape triggered (batchSize=${batchSize}, delayMs=${delayMs}, downloadPdf=${downloadPdf}, brandFilter=${brandFilter ?? '-'})`
      );
      const pool = getPool();
      const stats = await scrapeWiFddBatch(pool, { batchSize, delayMs, downloadPdf, brandFilter });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[franchise-sync-worker] WI FDD scrape failed: ${msg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }

  // Minnesota CARDS FDD scrape (batch)
  if (req.method === 'POST' && path === '/scrape-mn-fdd') {
    if (!checkAuth(req, res)) return;
    const qs = readJsonQuery(req.url);
    const batchSize = parseInt(qs.get('batchSize') || '50', 10);
    const delayMs = parseInt(qs.get('delayMs') || '2500', 10);
    const downloadPdf = qs.get('downloadPdf') !== 'false';
    const brandFilter = qs.get('brandFilter') || undefined;
    const yearLookback = qs.get('yearLookback')
      ? parseInt(qs.get('yearLookback')!, 10)
      : undefined;
    try {
      console.log(
        `[franchise-sync-worker] MN FDD scrape triggered (batchSize=${batchSize}, delayMs=${delayMs}, downloadPdf=${downloadPdf}, brandFilter=${brandFilter ?? '-'}, yearLookback=${yearLookback ?? 'default'})`
      );
      const pool = getPool();
      const stats = await scrapeMnFddBatch(pool, {
        batchSize,
        delayMs,
        downloadPdf,
        brandFilter,
        yearLookback,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[franchise-sync-worker] MN FDD scrape failed: ${msg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'franchise-sync-worker' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[franchise-sync-worker] listening on port ${PORT}`);
});

const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
for (const sig of signals) {
  process.on(sig, async () => {
    console.log(`[franchise-sync-worker] received ${sig}, shutting down`);
    server.close();
    await shutdown();
    process.exit(0);
  });
}
