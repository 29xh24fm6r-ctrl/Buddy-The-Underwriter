import "server-only";

import { NextResponse, NextRequest } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import {
  MODEL_REGISTRY,
  validateGovernanceInvariants,
} from "@/lib/modelGovernance/modelRegistry";
import { explainAllModels } from "@/lib/modelGovernance/explainModelOutput";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/governance/model-appendix";

/**
 * GET /api/governance/model-appendix
 *
 * Returns the complete model governance appendix:
 *  - Model registry (all registered AI models)
 *  - Explainability templates (per-model)
 *  - Override policy
 *  - Human-in-the-loop guarantees
 *  - Governance invariant validation
 *
 * Included automatically in Examiner Drop ZIP.
 */
export async function GET(_req: NextRequest) {
  const correlationId = generateCorrelationId("gov");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRoleApi(["super_admin", "bank_admin"]);

    const invariants = validateGovernanceInvariants();
    const explanations = explainAllModels();

    const appendix = {
      governance_version: "1.0",
      generated_at: ts,

      registry: MODEL_REGISTRY.map((m) => ({
        model_id: m.model_id,
        purpose: m.purpose,
        provider: m.provider,
        model_version: m.model_version,
        input_scope: m.input_scope,
        output_scope: m.output_scope,
        decision_authority: m.decision_authority,
        human_override_required: m.human_override_required,
        last_reviewed_at: m.last_reviewed_at,
      })),

      explainability: explanations,

      override_policy: {
        description:
          "When a human user disagrees with a model recommendation, an override " +
          "must be recorded with: (1) the model_id, (2) the overridden output, " +
          "(3) the reason for override, (4) the approving user ID, (5) a timestamp. " +
          "Overrides are immutable ledger events and appear in all audit artifacts.",
        override_is_mandatory: true,
        override_appears_in: [
          "Credit Decision Audit Pack (Phase F)",
          "Examiner Drop ZIP (Phase G)",
          "Deal Pipeline Ledger",
        ],
      },

      human_in_the_loop: {
        description:
          "All AI models in Buddy operate in assistive-only mode. No model has " +
          "autonomous decision authority. Final credit decisions are human-owned. " +
          "Every model output requires human review and explicit approval before " +
          "it influences a credit decision.",
        guarantees: [
          "No model can approve, decline, or modify a credit decision autonomously.",
          "Every model output is versioned and scoped to declared input/output boundaries.",
          "Model outputs carry confidence scores that are advisory, not prescriptive.",
          "Human overrides are always available and always recorded.",
          "Raw prompts and PII are never stored in model invocation logs.",
        ],
      },

      invariant_check: invariants,
    };

    return respond200(
      { ok: true, appendix, meta: { correlationId, ts } },
      headers,
    );
  } catch (err) {
    rethrowNextErrors(err);

    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: err.code },
        { status: err.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(err, "governance_appendix_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
