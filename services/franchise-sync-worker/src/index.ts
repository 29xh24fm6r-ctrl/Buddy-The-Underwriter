import 'dotenv/config';
import http from 'node:http';
import { getPool, shutdown } from './db.js';
import { syncSbaDirectory } from './syncSbaDirectory.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/') {
    const expectedSecret = process.env.CRON_SECRET;
    if (expectedSecret) {
      const authHeader = req.headers.authorization || '';
      const providedSecret = (req.headers['x-cron-secret'] as string) || '';
      if (
        providedSecret !== expectedSecret &&
        authHeader !== `Bearer ${expectedSecret}`
      ) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    try {
      console.log('[franchise-sync-worker] sync triggered');
      const pool = getPool();
      const stats = await syncSbaDirectory(pool);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[franchise-sync-worker] sync failed: ${msg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }

  if (req.url === '/health') {
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
