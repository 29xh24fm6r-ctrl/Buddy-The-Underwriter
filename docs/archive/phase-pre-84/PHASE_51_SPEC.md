# Phase 51 — Buddy Voice Gateway (Gemini Live)
## Implementation Spec for Claude Code (Antigravity)

**Prepared by:** Claude (schema reconciliation + Pulse architecture reference)
**Architecture source:** `29xh24fm6r-ctrl/PulseMasterrepo/services/voice-gateway/`
**Status:** Build-ready. Read every section before touching any file.

---

## CRITICAL CONTEXT — READ BEFORE ANY CODE

This phase mirrors the Pulse voice-gateway architecture exactly.
The Pulse implementation is the reference — read it before building anything:
- `services/voice-gateway/src/gemini/geminiProxy.ts` — the WebSocket proxy
- `services/voice-gateway/src/server.ts` — the gateway server
- `lib/voice/gemini/useGeminiLive.ts` — the client hook
- `app/api/voice/gemini-proxy-token/route.ts` — the token route

**Zero OpenAI.** Gemini handles STT + LLM + TTS natively in a single persistent
WebSocket connection. `gpt-4o-realtime-preview` is removed entirely.

**Model:** `gemini-live-2.5-flash-native-audio` via **Vertex AI**
(same GCP project + service account already used for document extraction).

**Auth pattern:** Vercel issues a short-lived UUID proxy token stored in
Supabase. Client opens WebSocket to Fly.io gateway. Gateway validates token,
opens upstream Vertex AI WebSocket server-side. API key never leaves the server.

**Why Fly.io:** Vercel serverless functions cannot hold a persistent WebSocket.
The Gemini Live API requires a stateful, long-lived bidirectional connection.
Fly.io runs a persistent Node.js process with `min_machines_running = 1`.

---

## WHAT THIS PHASE BUILDS

### Part A — `buddy-voice-gateway/` (new standalone service)
Standalone Node.js WebSocket server. Lives at repo root, deployed to Fly.io.
Mirrors `services/voice-gateway/` from Pulse exactly, adapted for Buddy.

**Files:**
```
buddy-voice-gateway/
├── Dockerfile
├── fly.toml
├── package.json
├── tsconfig.json
├── .dockerignore
└── src/
    ├── server.ts               ← HTTP + WS server, /health, /gemini-live route
    ├── gemini/
    │   └── geminiProxy.ts      ← Vertex AI WebSocket proxy + tool interception
    ├── dispatch/
    │   └── buddyDispatch.ts    ← Routes tool intents → Buddy Next.js API
    └── lib/
        ├── env.ts              ← env() helper
        └── supabase.ts         ← Supabase client (service role)
```

### Part B — Buddy Next.js changes
```
src/app/api/deals/[dealId]/banker-session/
├── gemini-token/route.ts       ← Issues proxy token (replaces /start route)
└── dispatch/route.ts           ← Receives tool calls from gateway, writes to deal_financial_facts
src/lib/voice/
└── useBuddyVoice.ts            ← Client hook (mirrors useGeminiLive.ts)
src/components/deals/
└── BankerVoicePanel.tsx        ← UI: mic button, status, transcript, gap progress
public/audio/
└── buddy-mic-processor.js      ← AudioWorklet for 16kHz mic capture
```

### Part C — Database
```sql
-- New table: deal_voice_sessions
-- Stores proxy token + session config for gateway auth
```

### Part D — Remove OpenAI voice
Delete `src/app/api/realtime/` directory entirely.
Remove `openai` import from `src/app/api/deals/[dealId]/banker-session/start/route.ts`
(the entire start route is replaced by gemini-token route).

---

## PART A — buddy-voice-gateway/

### `buddy-voice-gateway/fly.toml`

```toml
app = "buddy-voice-gateway"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

[checks]
  [checks.health]
    type = "http"
    port = 8080
    path = "/health"
    interval = "30s"
    timeout = "5s"
```

---

### `buddy-voice-gateway/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ dist/
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "dist/server.js"]
```

---

### `buddy-voice-gateway/package.json`

```json
{
  "name": "buddy-voice-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "node --loader ts-node/esm src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "google-auth-library": "^10.6.1",
    "uuid": "^10.0.0",
    "ws": "^8.18.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^20.19.33",
    "@types/ws": "^8.5.12",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.3"
  }
}
```

---

### `buddy-voice-gateway/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

---

### `buddy-voice-gateway/src/lib/env.ts`

```typescript
import { config } from "dotenv";
config();

export function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export function envOptional(key: string): string | undefined {
  return process.env[key];
}
```

---

### `buddy-voice-gateway/src/lib/supabase.ts`

```typescript
import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export const supabase = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);
```

---

### `buddy-voice-gateway/src/server.ts`

```typescript
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
```

---

### `buddy-voice-gateway/src/gemini/geminiProxy.ts`

This is the core file. Mirrors Pulse `geminiProxy.ts` exactly with Buddy-specific
tool routing and session table.

```typescript
/**
 * geminiProxy.ts — Gemini Live WebSocket proxy for Buddy credit interviews.
 *
 * Architecture:
 *   Browser ──ws──▷ Fly.io Gateway ──ws──▷ Vertex AI Gemini Live
 *              ◁── relay ◁──                │
 *                               tool call interception
 *                                           │
 *                              buddyDispatch → Buddy Next.js API
 *                                           │
 *                              Writes confirmed facts to deal_financial_facts
 *
 * Auth: short-lived proxy token stored in deal_voice_sessions.metadata
 * by POST /api/deals/[dealId]/banker-session/gemini-token
 */

import { WebSocket as WsClient, WebSocketServer } from "ws";
import type { WebSocket as WsServer, RawData } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { GoogleAuth } from "google-auth-library";
import { supabase } from "../lib/supabase.js";
import { env, envOptional } from "../lib/env.js";
import { routeBuddyIntent } from "../dispatch/buddyDispatch.js";

// ---------------------------------------------------------------------------
// Vertex AI config — same auth pattern as Pulse
// ---------------------------------------------------------------------------

const GCP_PROJECT_ID = env("GCP_PROJECT_ID");
const GCP_LOCATION = envOptional("GCP_LOCATION") ?? "us-central1";
const VERTEX_AI_HOST = `${GCP_LOCATION}-aiplatform.googleapis.com`;
const VERTEX_WS_URL =
  `wss://${VERTEX_AI_HOST}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;

const KEEPALIVE_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Single tool declaration — "buddy_query" routes to gap resolution engine
// ---------------------------------------------------------------------------

const BUDDY_QUERY_TOOL = {
  function_declarations: [
    {
      name: "buddy_query",
      description:
        "Resolve a gap or record a confirmed fact from the banker's answer. Use this whenever the banker provides a specific verifiable fact (dollar amount, date, percentage, name, address). Only objective, documentable facts. No subjective impressions.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent: {
            type: "STRING",
            description:
              "The banker's answer as a structured fact. Examples: 'confirm DSCR 4.27x', 'record occupancy rate 87%', 'confirm fleet size 28 vessels', 'record collateral appraised value 2400000', 'confirm business start date 2017'",
          },
          gap_id: {
            type: "STRING",
            description: "Optional. The gap_queue ID this answer resolves.",
          },
          fact_key: {
            type: "STRING",
            description: "Optional. The specific fact key being confirmed (e.g. OCCUPANCY_RATE, FLEET_SIZE).",
          },
          value: {
            type: "STRING",
            description: "Optional. The raw value as a string (numeric or text).",
          },
        },
        required: ["intent"],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// GCP Auth — service account OAuth2 (same pattern as extraction pipeline)
// ---------------------------------------------------------------------------

let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (authClient) return authClient;
  const keyBase64 = envOptional("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (keyBase64) {
    const keyJson = JSON.parse(Buffer.from(keyBase64, "base64").toString("utf8"));
    authClient = new GoogleAuth({
      credentials: keyJson,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  } else {
    authClient = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return authClient;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuthClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error("Failed to obtain GCP access token");
  return tokenResponse.token;
}

// ---------------------------------------------------------------------------
// Session metadata shape (matches what gemini-token route writes)
// ---------------------------------------------------------------------------

interface SessionMetadata {
  proxyToken?: string;
  proxyTokenExpiresAt?: string;
  proxyUserId?: string;        // Clerk userId
  proxyTraceId?: string;
  proxyDealId?: string;        // deal UUID
  proxyBankId?: string;
  proxyModel?: string;
  proxyVoice?: string;
  proxySystemInstruction?: string;
  proxyThinkingBudget?: number;
  proxyProactiveAudio?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleGeminiProxy(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });

  const clientWs = await new Promise<WsServer>((resolve) => {
    wss.handleUpgrade(req, socket, head, (ws: WsServer) => resolve(ws));
  });

  const url = new URL(req.url || "", `http://localhost`);
  const token = url.searchParams.get("token");
  const sessionId = url.searchParams.get("sessionId");

  if (!token || !sessionId) {
    console.error("[BUDDY_PROXY] Missing token or sessionId");
    clientWs.close(4001, "missing_params");
    return;
  }

  // Validate token against Supabase
  let metadata: SessionMetadata;
  try {
    const { data, error } = await supabase
      .from("deal_voice_sessions")
      .select("metadata")
      .eq("id", sessionId)
      .eq("state", "active")
      .maybeSingle();

    if (error || !data) {
      console.error("[BUDDY_PROXY] Session not found", { sessionId });
      clientWs.close(4001, "session_not_found");
      return;
    }

    metadata = (data.metadata ?? {}) as SessionMetadata;

    if (metadata.proxyToken !== token) {
      console.error("[BUDDY_PROXY] Token mismatch", { sessionId });
      clientWs.close(4001, "invalid_token");
      return;
    }

    if (metadata.proxyTokenExpiresAt) {
      if (Date.now() > new Date(metadata.proxyTokenExpiresAt).getTime()) {
        console.error("[BUDDY_PROXY] Token expired", { sessionId });
        clientWs.close(4001, "token_expired");
        return;
      }
    }
  } catch (err) {
    console.error("[BUDDY_PROXY] Auth error", err);
    clientWs.close(4001, "auth_error");
    return;
  }

  const userId = metadata.proxyUserId ?? "unknown";
  const dealId = metadata.proxyDealId ?? "unknown";
  const bankId = metadata.proxyBankId ?? "unknown";
  const traceId = metadata.proxyTraceId ?? "unknown";

  console.log("[BUDDY_PROXY] CONNECT", { userId, dealId, sessionId, traceId });

  // Open upstream Vertex AI WebSocket
  let upstreamWs: WsClient;
  try {
    const accessToken = await getAccessToken();
    upstreamWs = new WsClient(VERTEX_WS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error("[BUDDY_PROXY] Failed to open upstream WS", err);
    clientWs.close(4002, "upstream_connect_failed");
    return;
  }

  let upstreamReady = false;
  let clientClosed = false;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const setupMessage = buildSetupMessage(metadata);

  // ---- Upstream events ----

  upstreamWs.on("open", () => {
    upstreamReady = true;
    console.log("[BUDDY_PROXY] Upstream connected", { sessionId, traceId });

    try {
      upstreamWs.send(JSON.stringify(setupMessage));
      console.log("[BUDDY_PROXY] Setup sent", { model: metadata.proxyModel });
    } catch (err) {
      console.error("[BUDDY_PROXY] Setup send failed", err);
      clientWs.close(4002, "setup_failed");
      upstreamWs.close();
      return;
    }

    pingInterval = setInterval(() => {
      if (upstreamWs.readyState === WsClient.OPEN) upstreamWs.ping();
    }, KEEPALIVE_INTERVAL_MS);
  });

  upstreamWs.on("message", (data: RawData, isBinary: boolean) => {
    // Binary passes through immediately (audio chunks)
    if (isBinary) {
      if (clientWs.readyState === clientWs.OPEN) clientWs.send(data, { binary: true });
      return;
    }

    const text = typeof data === "string" ? data : (data as Buffer).toString("utf8");
    let parsed: Record<string, unknown> | null = null;

    try { parsed = JSON.parse(text); } catch {
      if (clientWs.readyState === clientWs.OPEN) clientWs.send(data, { binary: false });
      return;
    }

    // Tool call interception — handle server-side, never relay to client
    if (parsed?.toolCall) {
      const toolCall = parsed.toolCall as {
        functionCalls?: Array<{ name: string; args?: Record<string, unknown>; id?: string }>;
      };
      const calls = toolCall.functionCalls;

      if (calls && calls.length > 0) {
        const call = calls[0];
        if (call.name === "buddy_query") {
          const intent = String(call.args?.intent ?? "");
          const gapId = call.args?.gap_id ? String(call.args.gap_id) : undefined;
          const factKey = call.args?.fact_key ? String(call.args.fact_key) : undefined;
          const value = call.args?.value ? String(call.args.value) : undefined;

          console.log("[BUDDY_PROXY] Tool call intercepted", { sessionId, intent: intent.slice(0, 80) });

          void handleToolCall(
            call.id ?? call.name,
            call.name,
            intent,
            userId,
            dealId,
            bankId,
            sessionId,
            gapId,
            factKey,
            value,
            upstreamWs,
          );
          return;
        }
      }
    }

    // Normal relay: Gemini → Client
    if (clientWs.readyState === clientWs.OPEN) clientWs.send(data, { binary: false });
  });

  upstreamWs.on("close", (code: number, reason: Buffer) => {
    console.log("[BUDDY_PROXY] Upstream closed", { sessionId, code, reason: reason.toString() });
    if (pingInterval) clearInterval(pingInterval);
    if (!clientClosed && clientWs.readyState === clientWs.OPEN) {
      clientWs.close(code === 1000 ? 1000 : 4002, "upstream_closed");
    }
  });

  upstreamWs.on("error", (err: Error) => {
    console.error("[BUDDY_PROXY] Upstream error", { sessionId, error: err.message });
    if (pingInterval) clearInterval(pingInterval);
    if (!clientClosed && clientWs.readyState === clientWs.OPEN) {
      clientWs.close(4002, "upstream_error");
    }
  });

  // ---- Client events ----

  clientWs.on("message", (data: RawData, isBinary: boolean) => {
    if (upstreamReady && upstreamWs.readyState === WsClient.OPEN) {
      upstreamWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on("close", (code: number) => {
    clientClosed = true;
    console.log("[BUDDY_PROXY] Client closed", { sessionId, traceId, code });
    if (pingInterval) clearInterval(pingInterval);
    if (upstreamWs.readyState === WsClient.OPEN || upstreamWs.readyState === WsClient.CONNECTING) {
      upstreamWs.close();
    }
  });

  clientWs.on("error", (err: Error) => {
    console.error("[BUDDY_PROXY] Client error", { sessionId, error: err.message });
  });
}

// ---------------------------------------------------------------------------
// Tool call handler — routes to Buddy dispatch → writes confirmed facts
// ---------------------------------------------------------------------------

async function handleToolCall(
  callId: string,
  callName: string,
  intent: string,
  userId: string,
  dealId: string,
  bankId: string,
  sessionId: string,
  gapId: string | undefined,
  factKey: string | undefined,
  value: string | undefined,
  upstreamWs: WsClient,
): Promise<void> {
  try {
    const result = await routeBuddyIntent({
      intent,
      userId,
      dealId,
      bankId,
      sessionId,
      gapId,
      factKey,
      value,
    });

    const toolResponse = {
      toolResponse: {
        functionResponses: [{
          name: callName,
          response: result.success
            ? { result: JSON.stringify(result.data) }
            : { error: result.error ?? "Intent routing failed." },
        }],
      },
    };

    if (upstreamWs.readyState === WsClient.OPEN) {
      upstreamWs.send(JSON.stringify(toolResponse));
    }
  } catch (err) {
    console.error("[BUDDY_PROXY] Tool call error", { sessionId, error: String(err) });
    const errorResponse = {
      toolResponse: {
        functionResponses: [{
          name: callName,
          response: { error: "Internal tool routing error." },
        }],
      },
    };
    if (upstreamWs.readyState === WsClient.OPEN) {
      upstreamWs.send(JSON.stringify(errorResponse));
    }
  }
}

// ---------------------------------------------------------------------------
// Build Gemini Live setup message
// ---------------------------------------------------------------------------

function buildSetupMessage(meta: SessionMetadata): Record<string, unknown> {
  const model = meta.proxyModel ?? "gemini-live-2.5-flash-native-audio";

  const config: Record<string, unknown> = {
    response_modalities: ["AUDIO"],
    thinking_config: { thinking_budget: meta.proxyThinkingBudget ?? 0 },
    // Request text transcript as side channel — used for gap confirmation audit trail
    input_audio_transcription: {},
    output_audio_transcription: {},
  };

  if (meta.proxyVoice) {
    config.speech_config = {
      voice_config: {
        prebuilt_voice_config: { voice_name: meta.proxyVoice },
      },
    };
  }

  const setup: Record<string, unknown> = {
    model: `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${model}`,
    generation_config: config,
  };

  if (meta.proxySystemInstruction) {
    setup.system_instruction = {
      parts: [{ text: meta.proxySystemInstruction }],
    };
  }

  if (meta.proxyProactiveAudio !== false) {
    setup.proactivity = { proactive_audio: true };
  }

  setup.tools = [BUDDY_QUERY_TOOL];

  return { setup };
}
```

---

### `buddy-voice-gateway/src/dispatch/buddyDispatch.ts`

```typescript
/**
 * buddyDispatch.ts — Routes tool intents from Gemini to Buddy Next.js API.
 *
 * The gateway calls POST /api/deals/[dealId]/banker-session/dispatch on the
 * Buddy Vercel deployment. This route receives the banker's confirmed fact
 * and writes it to deal_financial_facts via resolveDealGap().
 */

import { env, envOptional } from "../lib/env.js";

const BUDDY_APP_URL = env("BUDDY_APP_URL");
const GATEWAY_SECRET = env("BUDDY_GATEWAY_SECRET");

interface DispatchArgs {
  intent: string;
  userId: string;
  dealId: string;
  bankId: string;
  sessionId: string;
  gapId?: string;
  factKey?: string;
  value?: string;
}

interface DispatchResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function routeBuddyIntent(args: DispatchArgs): Promise<DispatchResult> {
  const { dealId, ...rest } = args;

  try {
    const res = await fetch(
      `${BUDDY_APP_URL}/api/deals/${dealId}/banker-session/dispatch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gateway-secret": GATEWAY_SECRET,
        },
        body: JSON.stringify(rest),
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      return { success: false, error: `dispatch_http_${res.status}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

---

## PART B — Buddy Next.js Changes

### DB Migration: `deal_voice_sessions`

```sql
CREATE TABLE IF NOT EXISTS deal_voice_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id         uuid NOT NULL,
  user_id         text NOT NULL,  -- Clerk userId (not uuid)

  state           text NOT NULL DEFAULT 'active',
  -- 'active' | 'closed' | 'expired'

  -- All session config stored here for gateway to read on WS connect
  metadata        jsonb NOT NULL DEFAULT '{}',
  -- Keys written by gemini-token route:
  -- proxyToken, proxyTokenExpiresAt, proxyUserId, proxyTraceId
  -- proxyDealId, proxyBankId, proxyModel, proxyVoice
  -- proxySystemInstruction, proxyThinkingBudget, proxyProactiveAudio

  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE deal_voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_rls" ON deal_voice_sessions
  USING (bank_id = (SELECT bank_id FROM deals WHERE id = deal_id LIMIT 1));

-- Auto-expire old sessions
CREATE INDEX IF NOT EXISTS idx_deal_voice_sessions_expires
  ON deal_voice_sessions (expires_at)
  WHERE state = 'active';
```

---

### File: `src/app/api/deals/[dealId]/banker-session/gemini-token/route.ts`

Replaces the OpenAI `start/route.ts`. Same role: issues credentials for voice session.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

const PROXY_TOKEN_TTL_MS = 180_000; // 3 minutes

const GEMINI_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio";
const GEMINI_VOICE = process.env.GEMINI_LIVE_VOICE ?? "Puck";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // Load deal + open gaps + key metrics for system instruction
    const [dealRes, gapsRes, metricsRes] = await Promise.all([
      sb.from("deals").select("name, borrower_name, loan_amount, loan_type").eq("id", dealId).maybeSingle(),
      sb.from("deal_gap_queue").select("fact_key, description, resolution_prompt, priority")
        .eq("deal_id", dealId).eq("bank_id", bankPick.bankId).eq("status", "open")
        .order("priority", { ascending: false }).limit(10),
      sb.from("deal_financial_facts").select("fact_key, fact_value_num")
        .eq("deal_id", dealId).eq("bank_id", bankPick.bankId).eq("is_superseded", false)
        .in("fact_key", ["TOTAL_REVENUE", "NET_INCOME", "DSCR", "ANNUAL_DEBT_SERVICE"])
        .not("fact_value_num", "is", null),
    ]);

    const deal = dealRes.data;
    const openGaps = gapsRes.data ?? [];
    const metrics = metricsRes.data ?? [];

    // Build deal-aware system instruction
    const metricLines = metrics.map((m: any) =>
      `${m.fact_key}: ${Number(m.fact_value_num).toLocaleString()}`
    ).join(", ");

    const gapLines = openGaps.slice(0, 6).map((g: any, i: number) =>
      `${i + 1}. ${g.resolution_prompt ?? g.description}`
    ).join("\n");

    const systemInstruction = `You are Buddy, a senior credit analyst AI conducting a structured credit interview.

DEAL CONTEXT:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Loan: ${deal?.name ?? dealId} | Amount: $${Number(deal?.loan_amount ?? 0).toLocaleString()} | Type: ${deal?.loan_type ?? "Commercial"}
- Known metrics: ${metricLines || "None yet extracted"}

OPEN ITEMS (${openGaps.length} total — ask these in priority order):
${gapLines || "No open items — deal record is complete."}

YOUR RULES:
1. Ask about ONE open item at a time. Be specific, cite what you already know.
2. ONLY collect objective, verifiable facts: dollar amounts, dates, percentages, names, addresses, years, counts.
3. NEVER ask for subjective impressions ("does management seem strong", "is the borrower trustworthy"). These cannot appear in a credit file.
4. When you have confirmed a fact, use the buddy_query tool to record it immediately. Do not wait until the end.
5. Acknowledge facts the deal already has — never ask for something already confirmed.
6. Keep a professional but conversational tone. Be efficient. A full session should take 8-12 minutes.
7. Begin by briefly acknowledging what you know about the deal, then ask about the highest-priority open item.

COMPLIANCE: This session is fully audited. Every fact you record becomes part of a regulatory credit file. Subjectivity is a fair lending violation.`;

    // Create voice session
    const proxyToken = randomUUID();
    const traceId = randomUUID();
    const expiresAt = new Date(Date.now() + PROXY_TOKEN_TTL_MS).toISOString();
    const sessionId = randomUUID();

    const { error: insertError } = await sb.from("deal_voice_sessions").insert({
      id: sessionId,
      deal_id: dealId,
      bank_id: bankPick.bankId,
      user_id: userId,
      state: "active",
      expires_at: expiresAt,
      metadata: {
        proxyToken,
        proxyTokenExpiresAt: expiresAt,
        proxyUserId: userId,
        proxyTraceId: traceId,
        proxyDealId: dealId,
        proxyBankId: bankPick.bankId,
        proxyModel: GEMINI_MODEL,
        proxyVoice: GEMINI_VOICE,
        proxySystemInstruction: systemInstruction,
        proxyThinkingBudget: 0,
        proxyProactiveAudio: true,
      },
    });

    if (insertError) {
      return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        proxyToken,
        sessionId,
        traceId,
        model: GEMINI_MODEL,
        openGaps: openGaps.length,
        config: {
          model: GEMINI_MODEL,
          voice: GEMINI_VOICE,
          ttlMs: PROXY_TOKEN_TTL_MS,
          outputSampleRate: 24000,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

---

### File: `src/app/api/deals/[dealId]/banker-session/dispatch/route.ts`

Receives tool calls from the gateway, writes confirmed facts to the deal.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealGap } from "@/lib/gapEngine/resolveDealGap";

export const runtime = "nodejs";
export const maxDuration = 15;

const GATEWAY_SECRET = process.env.BUDDY_GATEWAY_SECRET ?? "";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  // Verify gateway secret — this route is called by Fly.io gateway, not browser
  const secret = req.headers.get("x-gateway-secret");
  if (!GATEWAY_SECRET || secret !== GATEWAY_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { dealId } = await props.params;
    const body = await req.json().catch(() => ({}));

    const {
      intent,
      userId,
      bankId,
      sessionId,
      gapId,
      factKey,
      value,
    } = body;

    // Log fact confirmation to deal_events
    const sb = supabaseAdmin();
    await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "voice.fact_confirmed",
      payload: {
        actor_user_id: userId,
        scope: "banker_voice_session",
        action: "voice_confirmed",
        meta: { intent, session_id: sessionId, gap_id: gapId, fact_key: factKey, value },
      },
    });

    // If we have enough structured info, resolve the gap directly
    if (gapId && value && factKey) {
      const numValue = parseFloat(value);
      const resolvedValue = isNaN(numValue) ? value : numValue;

      const result = await resolveDealGap({
        action: "provide_value",
        gapId,
        factType: "FINANCIAL",
        factKey,
        value: resolvedValue,
        userId,
        dealId,
        bankId,
      });

      return NextResponse.json({
        ok: result.ok,
        message: result.ok
          ? `Confirmed: ${factKey} = ${value}`
          : "Recorded for review",
        intent,
      });
    }

    // Unstructured intent — acknowledge, let Gemini continue conversation
    return NextResponse.json({
      ok: true,
      message: `Noted: ${intent}. Continue the interview to confirm specific values.`,
      intent,
    });
  } catch (e: unknown) {
    console.error("[banker-session/dispatch]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

---

### File: `public/audio/buddy-mic-processor.js`

AudioWorklet for 16kHz mic capture. Mirrors Pulse pattern exactly.

```javascript
/**
 * buddy-mic-processor.js — AudioWorklet for Gemini Live mic capture.
 * Runs in the audio thread. Accumulates PCM samples and posts
 * Int16Array chunks to the main thread every ~100ms.
 *
 * Place in /public/audio/ so Next.js serves it as a static file.
 */
class BuddyMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._samplesPerChunk = 1600; // 100ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(Math.max(-1, Math.min(1, samples[i])));
    }

    while (this._buffer.length >= this._samplesPerChunk) {
      const chunk = this._buffer.splice(0, this._samplesPerChunk);
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        int16[i] = chunk[i] * 32767;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("buddy-mic-processor", BuddyMicProcessor);
```

---

### File: `src/lib/voice/useBuddyVoice.ts`

Client hook. Mirrors `useGeminiLive.ts` from Pulse exactly, adapted for Buddy.
Key differences from Pulse:
- Token endpoint: `/api/deals/[dealId]/banker-session/gemini-token`
- AudioWorklet: `buddy-mic-processor`
- Gateway env: `NEXT_PUBLIC_BUDDY_VOICE_GATEWAY_URL`
- No TTL renewal (session is short, 8-12 min max)
- No Twilio/IVR concerns

```typescript
"use client";

/**
 * useBuddyVoice — Gemini Live native audio hook for banker credit interviews.
 *
 * Architecture:
 *   - POST /api/deals/[dealId]/banker-session/gemini-token → proxyToken + sessionId
 *   - WebSocket to buddy-voice-gateway /gemini-live?token=TOKEN&sessionId=ID
 *   - Gateway relays to Vertex AI Gemini Live (API key stays server-side)
 *   - Mic: 16kHz PCM via AudioWorklet (buddy-mic-processor.js)
 *   - Audio out: 24kHz PCM via AudioContext
 *   - Tool calls intercepted by gateway → writes to deal_financial_facts
 *
 * Same return shape as useGeminiLive. Drop-in for DealHealthPanel.
 */

import { useRef, useState, useCallback, useEffect } from "react";

const GATEWAY_WS_BASE =
  process.env.NEXT_PUBLIC_BUDDY_VOICE_GATEWAY_URL ?? "ws://localhost:8080";

const INPUT_SAMPLE_RATE = 16000;
const MAX_EARLY_CLOSE_RETRIES = 2;
const EARLY_CLOSE_BACKOFF = [150, 350, 700];

type VoiceStatus =
  | "idle" | "connecting" | "listening"
  | "speaking" | "processing" | "error" | "reconnecting";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface UseBuddyVoiceOptions {
  dealId: string;
  onStatusChange?: (status: VoiceStatus) => void;
  onMessage?: (msg: Message) => void;
  onGapResolved?: (factKey: string) => void;
}

let counter = 0;
function mkMsg(role: "user" | "assistant", content: string): Message {
  return { id: `bv-${++counter}-${Date.now()}`, role, content, timestamp: new Date() };
}

export function useBuddyVoice(options: UseBuddyVoiceOptions) {
  const { dealId, onStatusChange, onMessage, onGapResolved } = options;

  const [status, setStatusRaw] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const connectedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const connectAttemptIdRef = useRef(0);
  const earlyCloseRetryRef = useRef(0);
  const nextPlayTimeRef = useRef(0);
  const pendingAudioRef = useRef<AudioBufferSourceNode | null>(null);
  const isAssistantSpeakingRef = useRef(false);
  const sessionConfigRef = useRef<{ outputSampleRate: number } | null>(null);
  const statusRef = useRef<VoiceStatus>("idle");
  const connectInternalRef = useRef<() => Promise<void>>(async () => {});
  const startMicCaptureRef = useRef<(stream: MediaStream) => Promise<void>>(async () => {});

  const setStatus = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    setStatusRaw(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const pushMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
    onMessage?.(msg);
  }, [onMessage]);

  // ---- Audio playback (24kHz) ----

  const playAudioChunk = useCallback(async (base64Data: string, mimeType: string) => {
    try {
      if (!playbackCtxRef.current) {
        playbackCtxRef.current = new AudioContext({
          sampleRate: sessionConfigRef.current?.outputSampleRate ?? 24000,
        });
      }
      const ctx = playbackCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      let audioBuffer: AudioBuffer;

      if (mimeType.startsWith("audio/pcm")) {
        const sampleRate = sessionConfigRef.current?.outputSampleRate ?? 24000;
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
        audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
        audioBuffer.getChannelData(0).set(float32);
      } else {
        audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      isAssistantSpeakingRef.current = true;
      setIsAssistantSpeaking(true);
      setStatus("speaking");
      pendingAudioRef.current = source;

      source.onended = () => {
        if (pendingAudioRef.current === source) {
          pendingAudioRef.current = null;
          isAssistantSpeakingRef.current = false;
          setIsAssistantSpeaking(false);
          if (connectedRef.current) setStatus("listening");
        }
      };

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextPlayTimeRef.current);
      source.start(startAt);
      nextPlayTimeRef.current = startAt + audioBuffer.duration;
    } catch (e) {
      console.error("[BUDDY_VOICE] Audio playback error", e);
    }
  }, [setStatus]);

  const cancelAudioPlayback = useCallback(() => {
    try { if (pendingAudioRef.current) { pendingAudioRef.current.stop(); pendingAudioRef.current = null; } } catch { }
    nextPlayTimeRef.current = 0;
    isAssistantSpeakingRef.current = false;
    setIsAssistantSpeaking(false);
  }, []);

  // ---- WS message handler ----

  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(
        typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)
      );

      if (data.setupComplete) {
        connectedRef.current = true;
        setStatus("listening");
        if (streamRef.current) void startMicCaptureRef.current(streamRef.current);
        return;
      }

      if (data.serverContent) {
        const sc = data.serverContent;
        if (sc.modelTurn?.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData?.data) {
              void playAudioChunk(part.inlineData.data, part.inlineData.mimeType ?? "audio/pcm;rate=24000");
            }
            if (part.text) setCurrentTranscript(prev => prev + part.text);
          }
        }
        if (sc.turnComplete) {
          setCurrentTranscript(prev => {
            const text = prev.trim();
            if (text) pushMessage(mkMsg("assistant", text));
            return "";
          });
        }
        if (sc.inputTranscript) {
          setIsUserSpeaking(false);
          const t = sc.inputTranscript.trim();
          if (t) pushMessage(mkMsg("user", t));
        }
        if (sc.interrupted) cancelAudioPlayback();
      }

      // Tool call UI feedback (gateway handles actual routing, this is cosmetic)
      if (data.toolCall?.functionCalls) {
        setStatus("processing");
        const call = data.toolCall.functionCalls[0];
        if (call?.args?.fact_key && onGapResolved) {
          onGapResolved(String(call.args.fact_key));
        }
      }
    } catch (e) {
      console.warn("[BUDDY_VOICE] Message parse error", e);
    }
  }, [setStatus, playAudioChunk, cancelAudioPlayback, pushMessage, onGapResolved]);

  // ---- Mic capture (16kHz AudioWorklet) ----

  const startMicCapture = useCallback(async (stream: MediaStream) => {
    try {
      if (!captureCtxRef.current) {
        captureCtxRef.current = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      }
      const ctx = captureCtxRef.current;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      await ctx.audioWorklet.addModule("/audio/buddy-mic-processor.js");
      const worklet = new AudioWorkletNode(ctx, "buddy-mic-processor");
      workletRef.current = worklet;

      worklet.port.onmessage = (evt) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const int16 = new Int16Array(evt.data as ArrayBuffer);
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        wsRef.current.send(JSON.stringify({
          realtimeInput: { audio: { data: base64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` } },
        }));
        setIsUserSpeaking(true);
      };

      source.connect(worklet);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      worklet.connect(silentGain);
      silentGain.connect(ctx.destination);
    } catch (e) {
      console.error("[BUDDY_VOICE] Mic capture error", e);
    }
  }, []);

  startMicCaptureRef.current = startMicCapture;

  const stopMicCapture = useCallback(() => {
    try { if (workletRef.current) { workletRef.current.disconnect(); workletRef.current = null; } } catch { }
    try { if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; } } catch { }
    setIsUserSpeaking(false);
  }, []);

  const hardCloseWebSocket = useCallback((reason: string) => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
      ws.close();
    } catch { }
    wsRef.current = null;
  }, []);

  // ---- Connect ----

  const connectInternal = useCallback(async () => {
    connectAttemptIdRef.current++;
    const attemptId = connectAttemptIdRef.current;

    setStatus("connecting");
    setError(null);

    try {
      hardCloseWebSocket("restart");

      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: INPUT_SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      }

      if (attemptId !== connectAttemptIdRef.current) return;

      const res = await fetch(`/api/deals/${dealId}/banker-session/gemini-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      const data = await res.json();

      if (attemptId !== connectAttemptIdRef.current) return;

      if (!data.ok || !data.proxyToken || !data.sessionId) {
        setError(data.error ?? "Failed to get voice token.");
        setStatus("error");
        return;
      }

      sessionConfigRef.current = data.config ?? null;

      const wsUrl = `${GATEWAY_WS_BASE}/gemini-live?token=${encodeURIComponent(data.proxyToken)}&sessionId=${encodeURIComponent(data.sessionId)}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      let opened = false;

      ws.onopen = () => {
        if (attemptId !== connectAttemptIdRef.current) return;
        opened = true;
        earlyCloseRetryRef.current = 0;
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = () => {
        if (attemptId !== connectAttemptIdRef.current) return;
        setError("WebSocket connection error.");
        setStatus("error");
        connectedRef.current = false;
      };

      ws.onclose = (ev) => {
        if (attemptId !== connectAttemptIdRef.current) return;
        if (stopRequestedRef.current) return;

        if (!opened && ev.code !== 1000 && earlyCloseRetryRef.current < MAX_EARLY_CLOSE_RETRIES) {
          earlyCloseRetryRef.current++;
          const delay = EARLY_CLOSE_BACKOFF[earlyCloseRetryRef.current - 1] ?? 700;
          setTimeout(() => { if (!stopRequestedRef.current) void connectInternalRef.current(); }, delay);
          return;
        }

        connectedRef.current = false;
        stopMicCapture();
        if (statusRef.current !== "error") setStatus("idle");
      };
    } catch (e: unknown) {
      if (attemptId !== connectAttemptIdRef.current) return;
      const msg = e instanceof Error
        ? (e.name === "NotAllowedError" ? "Microphone access denied." : e.message)
        : "Connection failed.";
      setError(msg);
      setStatus("error");
    }
  }, [dealId, setStatus, hardCloseWebSocket, handleWsMessage, stopMicCapture]);

  connectInternalRef.current = connectInternal;

  const connect = useCallback(async () => {
    if (connectedRef.current) return;
    stopRequestedRef.current = false;
    earlyCloseRetryRef.current = 0;
    setMessages([]);
    setCurrentTranscript("");
    await connectInternal();
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    stopRequestedRef.current = true;
    connectedRef.current = false;
    stopMicCapture();
    cancelAudioPlayback();
    hardCloseWebSocket("disconnect");
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    for (const ref of [captureCtxRef, playbackCtxRef]) {
      if (ref.current) { try { ref.current.close(); } catch { } ref.current = null; }
    }
    setStatus("idle");
    setError(null);
    setIsUserSpeaking(false);
    setIsAssistantSpeaking(false);
    setCurrentTranscript("");
    setTimeout(() => { stopRequestedRef.current = false; earlyCloseRetryRef.current = 0; }, 0);
  }, [setStatus, stopMicCapture, cancelAudioPlayback, hardCloseWebSocket]);

  const sendTextMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !text.trim()) return;
    pushMessage(mkMsg("user", text));
    wsRef.current.send(JSON.stringify({
      clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
    }));
    setStatus("processing");
  }, [setStatus, pushMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch { }
      streamRef.current?.getTracks().forEach(t => t.stop());
      for (const ref of [captureCtxRef, playbackCtxRef]) {
        if (ref.current) { try { ref.current.close(); } catch { } }
      }
    };
  }, []);

  const isConnected = ["listening", "speaking", "processing", "reconnecting"].includes(status);

  return {
    status, error, messages, currentTranscript,
    isUserSpeaking, isAssistantSpeaking, isConnected,
    connect, disconnect, sendTextMessage,
  };
}
```

---

### File: `src/components/deals/BankerVoicePanel.tsx`

UI component. Wires up `useBuddyVoice` with status display, transcript, and gap progress.

```typescript
"use client";

import { useState, useCallback } from "react";
import { useBuddyVoice } from "@/lib/voice/useBuddyVoice";

const STATUS_DISPLAY = {
  idle:          { icon: "🎙", label: "Start Credit Interview", color: "text-gray-600" },
  connecting:    { icon: "⏳", label: "Connecting...",          color: "text-amber-600" },
  listening:     { icon: "👂", label: "Listening",              color: "text-emerald-600" },
  speaking:      { icon: "🔊", label: "Buddy is speaking",      color: "text-sky-600" },
  processing:    { icon: "⚡", label: "Recording fact...",      color: "text-purple-600" },
  error:         { icon: "⚠️", label: "Error",                  color: "text-rose-600" },
  reconnecting:  { icon: "🔄", label: "Reconnecting...",        color: "text-amber-600" },
};

export default function BankerVoicePanel({
  dealId,
  onGapResolved,
}: {
  dealId: string;
  onGapResolved?: (factKey: string) => void;
}) {
  const [resolvedKeys, setResolvedKeys] = useState<string[]>([]);

  const handleGapResolved = useCallback((factKey: string) => {
    setResolvedKeys(prev => prev.includes(factKey) ? prev : [...prev, factKey]);
    onGapResolved?.(factKey);
  }, [onGapResolved]);

  const { status, error, messages, currentTranscript,
          isUserSpeaking, isConnected, connect, disconnect } = useBuddyVoice({
    dealId,
    onGapResolved: handleGapResolved,
  });

  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.idle;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Credit Interview
          </span>
          <span className={`text-xs font-medium ${display.color}`}>
            {display.icon} {display.label}
          </span>
          {isUserSpeaking && (
            <span className="text-xs text-emerald-600 animate-pulse">● speaking</span>
          )}
        </div>
        <button
          onClick={isConnected ? disconnect : connect}
          className={`text-xs font-semibold px-3 py-1.5 rounded-md ${
            isConnected
              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
              : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {isConnected ? "End Session" : "Start Interview"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Facts confirmed this session */}
      {resolvedKeys.length > 0 && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100">
          <div className="text-xs font-semibold text-emerald-700 mb-1">
            ✓ Confirmed this session ({resolvedKeys.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {resolvedKeys.map(k => (
              <span key={k} className="text-[10px] font-mono bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Current transcript */}
      {currentTranscript && (
        <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 text-xs text-sky-800 italic">
          {currentTranscript}
        </div>
      )}

      {/* Message history */}
      <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
        {messages.length === 0 && !isConnected && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Start an interview to resolve open deal gaps with Buddy
          </div>
        )}
        {[...messages].reverse().map(msg => (
          <div key={msg.id} className={`px-4 py-2 ${msg.role === "assistant" ? "bg-gray-50" : ""}`}>
            <div className="text-[10px] text-gray-400 mb-0.5">
              {msg.role === "assistant" ? "Buddy" : "Banker"} · {msg.timestamp.toLocaleTimeString()}
            </div>
            <div className="text-xs text-gray-800">{msg.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## PART C — Environment Variables

### Fly.io gateway secrets (set via `fly secrets set`)
```
SUPABASE_URL=<buddy supabase url>
SUPABASE_SERVICE_ROLE_KEY=<buddy service role key>
GCP_PROJECT_ID=<same project used for Vertex AI extraction>
GCP_LOCATION=us-central1
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded service account JSON>
BUDDY_APP_URL=https://buddy.vercel.app  (or your Vercel domain)
BUDDY_GATEWAY_SECRET=<random UUID — shared secret between gateway and Vercel>
PORT=8080
```

### Vercel env vars (add to Vercel project settings)
```
NEXT_PUBLIC_BUDDY_VOICE_GATEWAY_URL=wss://buddy-voice-gateway.fly.dev
BUDDY_GATEWAY_SECRET=<same UUID as gateway>
GEMINI_LIVE_MODEL=gemini-live-2.5-flash-native-audio
GEMINI_LIVE_VOICE=Puck
```

---

## PART D — Remove OpenAI Voice

Delete these files entirely:
- `src/app/api/realtime/session/route.ts`
- `src/app/api/realtime/sdp/route.ts`
- `src/app/api/deals/[dealId]/banker-session/start/route.ts`

Remove `openai` package from Buddy's `package.json` if it was only used for voice.
(Check first — do not remove if used elsewhere.)

---

## PART E — Wire BankerVoicePanel into Pages

### Credit memo page (`src/app/(app)/credit-memo/[dealId]/canonical/page.tsx`):
```tsx
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
// Add alongside DealHealthPanel
<BankerVoicePanel dealId={dealId} onGapResolved={() => router.refresh()} />
```

### Deal page (wherever DealHealthPanel renders):
```tsx
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
<BankerVoicePanel dealId={dealId} />
```

---

## VALIDATION CHECKLIST

Before marking Phase 51 complete:

- [ ] `tsc` clean in `buddy-voice-gateway/` — zero type errors
- [ ] `tsc` clean in Buddy Next.js — zero type errors
- [ ] `deal_voice_sessions` table exists in Supabase with RLS enabled
- [ ] `fly deploy` succeeds from `buddy-voice-gateway/` — app listed as `buddy-voice-gateway`
- [ ] `curl https://buddy-voice-gateway.fly.dev/health` returns `{ status: "ok" }`
- [ ] POST `/api/deals/[dealId]/banker-session/gemini-token` returns `{ ok: true, proxyToken, sessionId }`
- [ ] WebSocket connection to `wss://buddy-voice-gateway.fly.dev/gemini-live?token=X&sessionId=Y` succeeds
- [ ] Gateway log shows "Upstream connected" and "Setup sent" on WS connect
- [ ] Microphone permission prompt appears in browser on "Start Interview"
- [ ] Buddy speaks a deal-aware opening (mentions borrower name, open gaps)
- [ ] Banker speaks a fact → gateway log shows "Tool call intercepted"
- [ ] POST to `/api/deals/[dealId]/banker-session/dispatch` receives the tool call
- [ ] `deal_financial_facts` updated with `resolution_status = confirmed` after fact confirmation
- [ ] `deal_events` contains `voice.fact_confirmed` event
- [ ] BankerVoicePanel shows confirmed facts in green "Confirmed this session" list
- [ ] End Session button closes WS cleanly (code 1000 in gateway log)
- [ ] Old `/api/realtime/` routes return 404

---

## NON-NEGOTIABLE INVARIANTS

- No OpenAI anywhere in the voice stack — Gemini handles STT + LLM + TTS natively
- API key (GEMINI_API_KEY / GCP service account) never touches the browser
- Proxy token TTL: 180 seconds — enforced by gateway on connect
- Only objective, verifiable facts are recorded — system instruction enforces this
- Every confirmed fact emits a `deal_events` ledger entry with `actor_user_id`
- `deal_voice_sessions` rows have RLS — only the deal's bank can read them
- Gateway secret (`x-gateway-secret`) validates all dispatch calls — no unauthenticated writes
- `deal_financial_facts` is still the canonical store — voice session writes through `resolveDealGap()`
