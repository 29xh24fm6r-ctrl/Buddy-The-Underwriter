export type PulseMcpConfig = {
  enabled: boolean;
  url: string | null;
  apiKey: string | null;
  timeoutMs: number;
  strict: boolean;
};

const bool = (v?: string) =>
  v ? ["1", "true", "yes", "on"].includes(v.toLowerCase()) : false;

const num = (v?: string, d = 3000) =>
  v && !isNaN(Number(v)) ? Number(v) : d;

export function getPulseMcpConfig(): PulseMcpConfig {
  return {
    enabled: bool(process.env.PULSE_MCP_ENABLED),
    url: process.env.PULSE_MCP_URL ?? null,
    apiKey: process.env.PULSE_MCP_API_KEY ?? null,
    timeoutMs: num(process.env.PULSE_MCP_TIMEOUT_MS, 3000),
    strict: bool(process.env.PULSE_MCP_STRICT),
  };
}
