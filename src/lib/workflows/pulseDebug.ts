import { PulseMcpClient } from "@/lib/pulseMcp/client";

const pulse = new PulseMcpClient();

function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("ssn") ||
      lk.includes("tax") ||
      lk.includes("account") ||
      lk.includes("routing") ||
      lk.includes("password") ||
      lk.includes("secret") ||
      lk.includes("token")
    ) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = typeof v === "object" ? redact(v) : v;
    }
  }
  return out;
}

export async function emitWorkflowEvent(args: {
  caseId: string;
  dealId?: string;
  step: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await pulse.emitEvent({
    type: `buddy.workflow.${args.level}`,
    entityType: "underwriting_case",
    entityId: args.caseId,
    payload: redact({
      step: args.step,
      dealId: args.dealId,
      message: args.message,
      meta: args.meta ?? {},
    }) as Record<string, unknown>,
  });
}
