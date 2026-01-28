import { getPulseMcpConfig, type PulseMcpConfig } from "./config";

type Json = Record<string, unknown>;

export class PulseMcpClient {
  private cfg: PulseMcpConfig;

  constructor() {
    this.cfg = getPulseMcpConfig();
  }

  private headers(): HeadersInit {
    const h: HeadersInit = { "content-type": "application/json" };
    if (this.cfg.apiKey) h["x-pulse-mcp-key"] = this.cfg.apiKey;
    return h;
  }

  private baseUrl(): string | null {
    if (!this.cfg.url) return null;
    // Strip /sse suffix to get base URL for HTTP endpoints
    return this.cfg.url.replace(/\/sse\/?$/, "");
  }

  isEnabled(): boolean {
    return this.cfg.enabled && !!this.cfg.url;
  }

  async ping(): Promise<{ connected: boolean; detail: string }> {
    if (!this.isEnabled()) {
      return { connected: false, detail: "disabled or url missing" };
    }

    const base = this.baseUrl();
    if (!base) {
      return { connected: false, detail: "url missing" };
    }

    try {
      const res = await fetch(`${base}/`, {
        method: "GET",
        headers: this.cfg.apiKey
          ? { "x-pulse-mcp-key": this.cfg.apiKey }
          : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });

      return res.ok
        ? { connected: true, detail: "ok" }
        : { connected: false, detail: `http ${res.status}` };
    } catch (e: unknown) {
      const err = e as Error;
      return { connected: false, detail: err?.name ?? "error" };
    }
  }

  /**
   * Emit Buddy events into Omega Prime for Claude debugging
   */
  async emitEvent(input: {
    type: string;
    entityType: string;
    entityId: string;
    payload: Json;
    ts?: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;

    const base = this.baseUrl();
    if (!base) return;

    const body = {
      tool: "omega.events.write",
      input: {
        source: "buddy",
        ...input,
        ts: input.ts ?? new Date().toISOString(),
      },
    };

    try {
      await fetch(`${base}/call`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch {
      // swallow - never block workflows
    }
  }

  /**
   * Call an arbitrary Pulse MCP tool
   */
  async callTool(
    tool: string,
    toolInput: Json = {}
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (!this.isEnabled()) {
      return { ok: false, error: "pulse_mcp_disabled" };
    }

    const base = this.baseUrl();
    if (!base) {
      return { ok: false, error: "url_missing" };
    }

    try {
      const res = await fetch(`${base}/call`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ tool, input: toolInput }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });

      if (!res.ok) {
        return { ok: false, error: `http_${res.status}` };
      }

      const data = await res.json();
      return { ok: true, result: data };
    } catch (e: unknown) {
      const err = e as Error;
      return { ok: false, error: err?.message ?? "unknown_error" };
    }
  }

  /**
   * List available tools from Pulse MCP
   */
  async listTools(): Promise<{ ok: boolean; tools?: unknown[]; error?: string }> {
    if (!this.isEnabled()) {
      return { ok: false, error: "pulse_mcp_disabled" };
    }

    const base = this.baseUrl();
    if (!base) {
      return { ok: false, error: "url_missing" };
    }

    try {
      // Try the /tools endpoint first (common MCP pattern)
      const res = await fetch(`${base}/tools`, {
        method: "GET",
        headers: this.cfg.apiKey
          ? { "x-pulse-mcp-key": this.cfg.apiKey }
          : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });

      if (!res.ok) {
        return { ok: false, error: `http_${res.status}` };
      }

      const data = await res.json();
      // Handle different response shapes
      const tools = Array.isArray(data)
        ? data
        : Array.isArray(data?.tools)
          ? data.tools
          : [];
      return { ok: true, tools };
    } catch (e: unknown) {
      const err = e as Error;
      return { ok: false, error: err?.message ?? "unknown_error" };
    }
  }
}

// Singleton instance for standalone functions
const _client = new PulseMcpClient();

/**
 * List available tools from Pulse MCP (standalone function)
 */
export async function listTools(): Promise<{ ok: boolean; tools?: unknown[]; error?: string }> {
  return _client.listTools();
}

/**
 * Call an arbitrary Pulse MCP tool (standalone function)
 */
export async function callTool(
  tool: string,
  toolInput: Json = {}
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return _client.callTool(tool, toolInput);
}
