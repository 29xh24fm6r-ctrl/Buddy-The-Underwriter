import { createServer } from "http";
import { WebSocketServer } from "ws";
import { env } from "./lib/env.js";
import { handleGeminiProxy } from "./gemini/geminiProxy.js";

const PORT = Number(env("PORT"));

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket upgrade required");
});

const wss = new WebSocketServer({ noServer: true });

server.listen(PORT, () => {
  console.log(`[buddy-voice-gateway] listening on :${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);

  if (url.pathname === "/gemini-live") {
    handleGeminiProxy(req, socket as any, head).catch((err) => {
      console.error("[GeminiProxy] Fatal error:", err);
      socket.destroy();
    });
    return;
  }

  // Unknown path
  socket.destroy();
});

function shutdown(signal: string) {
  console.log(`[buddy-voice-gateway] ${signal} received, shutting down...`);
  for (const client of wss.clients) {
    try { client.close(1001, "server_shutdown"); } catch { }
  }
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
