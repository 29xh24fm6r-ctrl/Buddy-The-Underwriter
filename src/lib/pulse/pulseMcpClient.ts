import "server-only";

import { z } from "zod";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const Env = z.object({
  PULSE_MCP_ENABLED: z.string().optional(),
  PULSE_MCP_TRANSPORT: z.enum(["sse", "stdio"]).default("sse"),
  PULSE_MCP_URL: z.string().optional(),
  PULSE_MCP_API_KEY: z.string().optional(),
  PULSE_MCP_STDIO_CMD: z.string().optional(),
  PULSE_MCP_STDIO_ARGS: z.string().optional(),
});

type PulseToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type PulseMcpStatus = {
  enabled: boolean;
  transport: "sse" | "stdio";
  connected: boolean;
  serverName?: string;
  serverVersion?: string;
  tools?: string[];
  error?: string;
};

let _client: Client | null = null;
let _status: PulseMcpStatus | null = null;
let _connecting: Promise<void> | null = null;

function readEnv() {
  const e = Env.parse(process.env);
  const enabled = (e.PULSE_MCP_ENABLED ?? "false").toLowerCase() === "true";
  return { ...e, enabled };
}

function buildSseTransport(url: string, apiKey: string | undefined) {
  if (!apiKey) {
    return new SSEClientTransport(new URL(url));
  }

  const authHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` };

  return new SSEClientTransport(new URL(url), {
    // Inject auth into the SSE stream via a custom fetch wrapper
    eventSourceInit: {
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        globalThis.fetch(input, {
          ...init,
          headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...authHeaders },
        })) as typeof globalThis.fetch,
    },
    // Inject auth into POST requests
    requestInit: { headers: authHeaders },
  });
}

function buildStdioTransport(cmd: string, rawArgs: string | undefined) {
  return new StdioClientTransport({
    command: cmd,
    args: (rawArgs || "").split(" ").filter(Boolean),
  });
}

async function connectOnce() {
  const {
    enabled,
    PULSE_MCP_TRANSPORT,
    PULSE_MCP_URL,
    PULSE_MCP_API_KEY,
    PULSE_MCP_STDIO_CMD,
    PULSE_MCP_STDIO_ARGS,
  } = readEnv();

  _status = { enabled, transport: PULSE_MCP_TRANSPORT, connected: false };

  if (!enabled) return;

  // Guard rails — validate required env per transport
  if (PULSE_MCP_TRANSPORT === "stdio" && !PULSE_MCP_STDIO_CMD) {
    _status.error = "PULSE_MCP_STDIO_CMD missing";
    return;
  }
  if (PULSE_MCP_TRANSPORT === "sse" && !PULSE_MCP_URL) {
    _status.error = "PULSE_MCP_URL missing";
    return;
  }

  const client = new Client(
    { name: "buddy-pulse-connector", version: "1.0.0" },
    { capabilities: {} },
  );

  const transport =
    PULSE_MCP_TRANSPORT === "stdio"
      ? buildStdioTransport(PULSE_MCP_STDIO_CMD!, PULSE_MCP_STDIO_ARGS)
      : buildSseTransport(PULSE_MCP_URL!, PULSE_MCP_API_KEY);

  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  const toolsResult = await client.listTools().catch(() => ({ tools: [] as { name: string }[] }));

  _client = client;
  _status = {
    enabled,
    transport: PULSE_MCP_TRANSPORT,
    connected: true,
    serverName: serverVersion?.name,
    serverVersion: serverVersion?.version,
    tools: toolsResult.tools.map((t) => t.name).filter(Boolean),
  };
}

export async function getPulseMcpClient(): Promise<Client | null> {
  const { enabled } = readEnv();
  if (!enabled) return null;

  if (_client) return _client;

  if (!_connecting) {
    _connecting = connectOnce().finally(() => {
      _connecting = null;
    });
  }
  await _connecting;
  return _client;
}

export async function getPulseMcpStatus(): Promise<PulseMcpStatus> {
  try {
    if (!_status) await connectOnce();
    return _status || { enabled: false, transport: "sse", connected: false };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return {
      enabled: (process.env.PULSE_MCP_ENABLED ?? "false") === "true",
      transport: (process.env.PULSE_MCP_TRANSPORT as "sse" | "stdio") || "sse",
      connected: false,
      error: msg,
    };
  }
}

export async function pulseToolCall(call: PulseToolCall) {
  const client = await getPulseMcpClient();
  if (!client) return { ok: false, error: "pulse_mcp_disabled" };

  return client.callTool({
    name: call.name,
    arguments: call.arguments ?? {},
  });
}
