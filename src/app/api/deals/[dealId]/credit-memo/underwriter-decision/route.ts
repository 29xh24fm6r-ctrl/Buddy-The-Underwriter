import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { recordUnderwriterDecision } from "@/lib/creditMemo/underwriter/recordUnderwriterDecision";
import type {
  UnderwriterCondition,
  UnderwriterDecision,
  UnderwriterRequestedChange,
} from "@/lib/creditMemo/underwriter/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_SUMMARY_LENGTH = 8_000;
const MAX_FEEDBACK_ITEMS = 50;
const MAX_FEEDBACK_TEXT_LENGTH = 2_000;

const ALLOWED_DECISIONS: ReadonlySet<UnderwriterDecision> = new Set([
  "approved",
  "declined",
  "returned_for_revision",
]);

const ALLOWED_SEVERITIES: ReadonlySet<
  UnderwriterRequestedChange["severity"]
> = new Set(["minor", "material", "blocker"]);

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

    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

    const body = (await req.json().catch(() => ({}))) as {
      snapshotId?: unknown;
      decision?: unknown;
      summary?: unknown;
      requested_changes?: unknown;
      conditions?: unknown;
    };

    const snapshotId =
      typeof body.snapshotId === "string" ? body.snapshotId.trim() : "";
    const decision =
      typeof body.decision === "string" &&
      ALLOWED_DECISIONS.has(body.decision as UnderwriterDecision)
        ? (body.decision as UnderwriterDecision)
        : null;
    const summary =
      typeof body.summary === "string" ? body.summary.trim() : "";

    if (
      !snapshotId ||
      !decision ||
      !summary ||
      summary.length > MAX_SUMMARY_LENGTH
    ) {
      return NextResponse.json(
        { ok: false, error: "missing_or_invalid_required_fields" },
        { status: 400, headers: NO_STORE },
      );
    }

    const requestedChanges = parseRequestedChanges(body.requested_changes);
    const conditions = parseConditions(body.conditions);
    if (requestedChanges === null || conditions === null) {
      return NextResponse.json(
        { ok: false, error: "invalid_underwriter_feedback" },
        { status: 400, headers: NO_STORE },
      );
    }

    const result = await recordUnderwriterDecision({
      dealId,
      snapshotId,
      underwriterId: access.userId,
      feedback: {
        decision,
        summary,
        requested_changes: requestedChanges,
        conditions,
      },
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE },
    );
  } catch (error: unknown) {
    rethrowNextErrors(error);
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        {
          status: error.code === "not_authenticated" ? 401 : 403,
          headers: NO_STORE,
        },
      );
    }

    const code = error instanceof Error ? error.message : "";
    console.error("[credit-memo/underwriter-decision POST]", error);

    if (code === "underwriter_separation_of_duties") {
      return NextResponse.json(
        { ok: false, error: code },
        { status: 403, headers: NO_STORE },
      );
    }
    if (
      code === "snapshot_not_in_banker_submitted_state" ||
      code === "snapshot_submitter_provenance_missing"
    ) {
      return NextResponse.json(
        { ok: false, error: code },
        { status: 409, headers: NO_STORE },
      );
    }
    if (code === "decision_status_sync_failed") {
      return NextResponse.json(
        { ok: false, error: code },
        { status: 503, headers: NO_STORE },
      );
    }
    if (code === "decision_reconciliation_required") {
      return NextResponse.json(
        { ok: false, error: code },
        { status: 500, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: false, error: "underwriter_decision_unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}

function parseRequestedChanges(
  value: unknown,
): UnderwriterRequestedChange[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_FEEDBACK_ITEMS) return null;

  const items: UnderwriterRequestedChange[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const sectionKey =
      typeof record.section_key === "string"
        ? record.section_key.trim()
        : "";
    const comment =
      typeof record.comment === "string" ? record.comment.trim() : "";
    const severity =
      typeof record.severity === "string" &&
      ALLOWED_SEVERITIES.has(
        record.severity as UnderwriterRequestedChange["severity"],
      )
        ? (record.severity as UnderwriterRequestedChange["severity"])
        : null;

    if (
      !sectionKey ||
      sectionKey.length > 200 ||
      !comment ||
      comment.length > MAX_FEEDBACK_TEXT_LENGTH ||
      !severity
    ) {
      return null;
    }
    items.push({
      section_key: sectionKey,
      comment,
      severity,
    });
  }

  return items;
}

function parseConditions(value: unknown): UnderwriterCondition[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_FEEDBACK_ITEMS) return null;

  const items: UnderwriterCondition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const label =
      typeof record.label === "string" ? record.label.trim() : "";
    const owner =
      typeof record.owner === "string" &&
      ALLOWED_OWNERS.has(record.owner as UnderwriterCondition["owner"])
        ? (record.owner as UnderwriterCondition["owner"])
        : null;
    const dueBefore =
      typeof record.due_before === "string" &&
      ALLOWED_DUE.has(
        record.due_before as UnderwriterCondition["due_before"],
      )
        ? (record.due_before as UnderwriterCondition["due_before"])
        : null;

    if (
      !label ||
      label.length > MAX_FEEDBACK_TEXT_LENGTH ||
      !owner ||
      !dueBefore
    ) {
      return null;
    }
    items.push({
      label,
      owner,
      due_before: dueBefore,
    });
  }

  return items;
}
