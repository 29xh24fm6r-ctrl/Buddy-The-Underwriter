export interface SBAGenerationStreamEvent {
  step: string;
  pct: number;
  error?: string;
  result?: Record<string, unknown>;
}

export function parseSBAGenerationStreamBlock(
  block: string,
): SBAGenerationStreamEvent | null {
  const payload = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as Partial<SBAGenerationStreamEvent>;
    if (
      typeof parsed.step !== "string" ||
      typeof parsed.pct !== "number" ||
      !Number.isFinite(parsed.pct)
    ) {
      return null;
    }
    return parsed as SBAGenerationStreamEvent;
  } catch {
    return null;
  }
}

export async function readSBAGenerationFailure(
  response: Response,
): Promise<string> {
  const fallback = response.ok
    ? "Generation endpoint returned an unexpected response."
    : `Generation request failed (HTTP ${response.status}).`;

  try {
    const text = await response.text();
    if (!text.trim()) return fallback;

    const parsed = JSON.parse(text) as {
      error?: unknown;
      blockers?: unknown;
      message?: unknown;
    };
    if (Array.isArray(parsed.blockers)) {
      const blockers = parsed.blockers.filter(
        (item): item is string => typeof item === "string",
      );
      if (blockers.length > 0) return blockers.join(" ");
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // The fallback is intentionally stable; never expose an HTML error page.
  }

  return fallback;
}
