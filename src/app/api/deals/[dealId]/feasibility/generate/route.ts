import "server-only";

// src/app/api/deals/[dealId]/feasibility/generate/route.ts
// Phase God Tier Feasibility — Phase 2 Gap B step 8/9.
// Now streams progress via SSE when the client requests it. Clients that
// don't ask for SSE get the original synchronous JSON response — no
// behavior change for existing callers.

import { NextRequest } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { generateFeasibilityStudy } from "@/lib/feasibility/feasibilityEngine";
import { enrichFeasibilityStudy } from "@/lib/feasibility/enrichFeasibilityStudy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FeasibilityResult } from "@/lib/feasibility/types";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — citation attribution + verifier pass,
 * best-effort. The study itself already generated and persisted
 * successfully by the time this runs — a failure here must never turn a
 * successful generation into an error response.
 */
async function runEnrichment(
  dealId: string,
  bankId: string,
  result: FeasibilityResult,
  sb: ReturnType<typeof supabaseAdmin>,
): Promise<void> {
  if (!result.ok || !result.studyId || !result.composite) return;
  try {
    await enrichFeasibilityStudy({ dealId, bankId, studyId: result.studyId, composite: result.composite, sb });
  } catch (err) {
    console.error("[feasibility/generate] enrichment failed (non-fatal):", err);
  }
}

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return new Response(JSON.stringify({ ok: false, error: access.error }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();
  const bankId = (deal as { bank_id?: string } | null)?.bank_id;
  if (!bankId) {
    return new Response(
      JSON.stringify({ ok: false, error: "Deal has no bank_id" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const wantsStream = req.headers.get("accept")?.includes("text/event-stream");

  if (!wantsStream) {
    try {
      const result = await generateFeasibilityStudy({ dealId, bankId });
      await runEnrichment(dealId, bankId, result, sb);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Feasibility generation failed";
      console.error("[feasibility/generate]", err);
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // SSE streaming response.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (
        step: string,
        pct: number,
        extra?: Record<string, unknown>,
      ) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ step, pct, ...extra })}\n\n`,
            ),
          );
        } catch {
          // Controller may already be closed if the client disconnected.
        }
      };

      try {
        const result = await generateFeasibilityStudy({
          dealId,
          bankId,
          onProgress: (step, pct) => send(step, pct),
        });
        await runEnrichment(dealId, bankId, result, sb);

        if (result.ok) {
          send("Complete!", 100, {
            result: {
              ok: true,
              studyId: result.studyId,
              compositeScore: result.composite?.overallScore,
              recommendation: result.composite?.recommendation,
              pdfUrl: result.pdfUrl,
            },
          });
        } else {
          send("Error", 0, { error: result.error ?? "Generation failed" });
        }
      } catch (err) {
        send("Error", 0, {
          error: err instanceof Error ? err.message : "Generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
