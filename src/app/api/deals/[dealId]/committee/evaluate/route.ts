/**
 * Committee Evaluation API
 * Run multi-persona evaluation on a deal
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runCommittee,
  formatCommitteeSummary,
  type PersonaKey,
} from "@/lib/sba/committee";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_QUESTION_LENGTH = 4_000;
const ALLOWED_PERSONAS: ReadonlySet<PersonaKey> = new Set([
  "credit",
  "sba_compliance",
  "risk",
  "relationship_manager",
]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await context.params;
    const access = await requireDealAccess(dealId);
    const body = await req.json().catch(() => ({}));
    const question =
      typeof body?.question === "string" ? body.question.trim() : "";
    const requestedBankId =
      typeof body?.bankId === "string" ? body.bankId.trim() : "";

    if (!question || question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: "invalid_question" },
        { status: 400, headers: NO_STORE },
      );
    }

    if (requestedBankId && requestedBankId !== access.bankId) {
      return NextResponse.json(
        { ok: false, error: "bank_scope_mismatch" },
        { status: 403, headers: NO_STORE },
      );
    }

    const personas = parsePersonas(body?.personas);
    if (personas === null) {
      return NextResponse.json(
        { ok: false, error: "invalid_personas" },
        { status: 400, headers: NO_STORE },
      );
    }

    const result = await runCommittee({
      dealId,
      bankId: access.bankId,
      question,
      personas,
    });

    return NextResponse.json(
      {
        ok: true,
        event_id: result.event_id,
        evaluations: result.evaluations,
        consensus: result.consensus,
        summary: formatCommitteeSummary(result),
      },
      { headers: NO_STORE },
    );
  } catch (error: unknown) {
    rethrowNextErrors(error);
    console.error("[committee/evaluate POST]", error);
    return NextResponse.json(
      { ok: false, error: "committee_evaluation_unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}

function parsePersonas(value: unknown): PersonaKey[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) return null;

  const personas: PersonaKey[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !ALLOWED_PERSONAS.has(item as PersonaKey) ||
      personas.includes(item as PersonaKey)
    ) {
      return null;
    }
    personas.push(item as PersonaKey);
  }

  return personas;
}
