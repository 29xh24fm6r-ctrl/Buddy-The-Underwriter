import express from "express";
import { rawBodySaver } from "./middleware/rawBody";
import { ingestBuddy } from "./routes/ingestBuddy";
import { runBuddyIncidentDetector } from "./incidents/buddyDetector";

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => rawBodySaver(req as any, res as any, buf),
    limit: "1mb",
  })
);

// ── Routes ──────────────────────────────────────────────
app.post("/ingest/buddy", ingestBuddy);

// ── Tick (canonical fail-soft) ──────────────────────────
app.post("/tick", async (_req, res) => {
  try {
    const result = await runBuddyIncidentDetector();
    res.json({ ok: true, buddy_incidents: result });
  } catch {
    // swallow — tick must never fail
    res.json({ ok: true });
  }
});

// ── Health ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "pulse-mcp" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`Pulse MCP listening on :${port}`);
});
