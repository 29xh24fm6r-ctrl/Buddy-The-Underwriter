import { spawnSync } from 'node:child_process';
import { run } from 'node:test';
import { tap } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';
import { discoverTestFiles } from './discover-tests.mjs';

// No live network in either test process. Mocked providers are
// deliberate: this proves internal contracts, not model quality or live access.
const guard = fileURLToPath(new URL('./token-free-network-guard.cjs', import.meta.url));
if (!process.argv.includes('--suite')) {
  for (const server of [false, true]) {
    const result = spawnSync(process.execPath, ['--require', guard,
      ...(server ? ['--conditions=react-server'] : []), '--import', 'tsx',
      fileURLToPath(import.meta.url), '--suite', ...(server ? ['--react-server'] : [])],
      { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: `--require=${guard}` } });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
  }
} else {
  const server = process.argv.includes('--react-server');
  const relevant = p => /src\/lib\/(borrower\/|brokerage\/|sba\/|feasibility\/|modelEngine\/.*package|creditMemo\/canonical\/|ai\/|score\/|documents\/|documentTruth\/|intake\/|storage\/|qaIdentity\/)|scripts\/__tests__\/borrowerJourney|src\/components\/borrower\/|src\/app\/api\/(borrower|brokerage)\//.test(p);
  const files = discoverTestFiles({ reactServer: server }).filter(relevant);
  console.log(`Token-free: ${files.length} files (${server ? 'react-server' : 'standard'}); network disabled`);
  let failures = 0;
  const stream = run({ files, concurrency: 4 });
  stream.on('test:fail', event => { if (!event.skip && !event.todo) failures++; });
  stream.compose(tap).pipe(process.stdout);
  stream.on('end', () => { process.exitCode = files.length && !failures ? 0 : 1; });
}
