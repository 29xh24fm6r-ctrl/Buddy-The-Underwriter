import 'dotenv/config';
import http from 'node:http';
import { getPool, shutdown } from './db.js';
import { extractFddBatch } from './extractionOrchestrator.js';

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

  if (req.method === 'POST' && path === '/extract-fdd') {
    if (!checkAuth(req, res)) return;
    const qs = readJsonQuery(req.url);
    const batchSize = parseInt(qs.get('batchSize') || '5', 10);
    const delayMs = parseInt(qs.get('delayMs') || '5000', 10);
    try {
      console.log(
        `[franchise-fdd-extractor] extract triggered (batchSize=${batchSize}, delayMs=${delayMs})`
      );
      const pool = getPool();
      const stats = await extractFddBatch(pool, { batchSize, delayMs });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[franchise-fdd-extractor] extract failed: ${msg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'franchise-fdd-extractor' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[franchise-fdd-extractor] listening on port ${PORT}`);
});

const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
for (const sig of signals) {
  process.on(sig, async () => {
    console.log(`[franchise-fdd-extractor] received ${sig}, shutting down`);
    server.close();
    await shutdown();
    process.exit(0);
  });
}
