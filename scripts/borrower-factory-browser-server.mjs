// Isolated component harness: no production route, credentials, database, or model calls.
import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import http from "node:http";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const dir = await mkdtemp(join(tmpdir(), "buddy-borrower-ui-"));
await build({
  entryPoints: ["e2e/borrower-factory/fixture.tsx"],
  bundle: true,
  outfile: join(dir, "app.js"),
  platform: "browser",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.NEXT_PUBLIC_POSTHOG_KEY": '""',
  },
});
const css = await postcss([tailwind({ base: process.cwd() })]).process(
  '@import "tailwindcss"; @source "../src"; body {background:#f6f8fb;font-family:Arial,sans-serif;color:#0f172a} button,a,input,textarea,select,summary {outline-offset:4px} button:focus-visible,a:focus-visible,summary:focus-visible {outline:3px solid #0369a1}',
  { from: resolve("e2e/factory.css") },
);
await writeFile(join(dir, "app.css"), css.css);
const server = http.createServer(async (req, res) => {
  const name = req.url?.split("?")[0];
  if (name === "/app.js" || name === "/app.css") {
    res.setHeader(
      "content-type",
      name.endsWith("js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(join(dir, name.slice(1))));
    return;
  }
  if (name?.startsWith("/api/")) {
    res.writeHead(501);
    res.end("Test must stub API requests");
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Buddy borrower UI fixture</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
server.listen(3107, "127.0.0.1", () =>
  console.log("Borrower fixture ready on http://127.0.0.1:3107"),
);
