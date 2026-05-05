import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { recordUnderwriterDecision } from "@/lib/creditMemo/underwriter/recordUnderwriterDecision";
import type {
  UnderwriterCondition,
  UnderwriterDecision,
  UnderwriterRequestedChange,
} from "@/lib/creditMemo/underwriter/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_DECISIONS: ReadonlySet<UnderwriterDecision> = new Set([
  "approved",
  "declined",
  "returned_for_revision",
]);

const ALLOWED_SEVERITIES: ReadonlySet<UnderwriterRequestedChange["severity"]> = new Set([
  "minor",
  "material",
  "blocker",
]);

const ALLOWED_OWNERS: ReadonlySet<UnderwriterCondition["owner"]> = new Set([
  "banker",
  "borrower",
  "underwriter",
]);

const ALLOWED_DUE: ReadonlySet<UnderwriterCondition["due_before"]> = new Set([
  "closing",
  "approval",
  "funding",
]);

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await requireDealAccess(dealId);

    const body = (await req.json().catch(() => ({}))) as {
      snapshotId?: unknown;
      decision?: unknown;
      summary?: unknown;
      requested_changes?: unknown;
      conditions?: unknown;
    };

    const snapshotId = typeof body.snapshotId === "string" ? body.snapshotId : null;
    const decision =
      typeof body.decision === "string" && ALLOWED_DECISIONS.has(body.decision as UnderwriterDecision)
        ? (body.decision as UnderwriterDecision)
        : null;
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";

    if (!snapshotId || !decision || summary.length === 0) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    const requested_changes = filterRequestedChanges(body.requested_changes);
    const conditions = filterConditions(body.conditions);

    const result = await recordUnderwriterDecision({
      dealId,
      snapshotId,
      underwriterId: access.userId,
      feedback: { decision, summary, requested_changes, conditions },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    const message = e instanceof Error ? e.message : String(e);
    const status = message.includes("snapshot_not_in_banker_submitted_state") ? 409 : 500;
    console.error("[credit-memo/underwriter-decision POST]", e);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

function filterRequestedChanges(value: unknown): UnderwriterRequestedChange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v): UnderwriterRequestedChange | null => {
      if (!v || typeof v !== "object") return null;
      const r = v as Record<string, unknown>;
      const section_key = typeof r.section_key === "string" ? r.section_key : null;
      const comment = typeof r.comment === "string" ? r.comment : null;
      const severity =
        typeof r.severity === "string" && ALLOWED_SEVERITIES.has(r.severity as UnderwriterRequestedChange["severity"])
          ? (r.severity as UnderwriterRequestedChange["severity"])
          : null;
      if (!section_key || !comment || !severity) return null;
      return { section_key, comment, severity };
    })
    .filter((x): x is UnderwriterRequestedChange => x !== null);
}

function filterConditions(value: unknown): UnderwriterCondition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v): UnderwriterCondition | null => {
      if (!v || typeof v !== "object") return null;
      const c = v as Record<string, unknown>;
      const label = typeof c.label === "string" ? c.label : null;
      const owner =
        typeof c.owner === "string" && ALLOWED_OWNERS.has(c.owner as UnderwriterCondition["owner"])
          ? (c.owner as UnderwriterCondition["owner"])
          : null;
      const due_before =
        typeof c.due_before === "string" && ALLOWED_DUE.has(c.due_before as UnderwriterCondition["due_before"])
          ? (c.due_before as UnderwriterCondition["due_before"])
          : null;
      if (!label || !owner || !due_before) return null;
      return { label, owner, due_before };
    })
    .filter((x): x is UnderwriterCondition => x !== null);
}
