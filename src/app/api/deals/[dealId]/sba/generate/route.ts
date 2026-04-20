import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

async function ensureSbaDealOrReturn403(dealId: string): Promise<Response | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .single();
  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA Package is not available for this deal type." },
      { status: 403 },
    );
  }
  return null;
}

// Phase 2 — heartbeat milestone map for the streaming progress response.
// We can't introspect inside generateSBAPackage without refactoring the
// 3-gate / 5-pass architecture, so we emit a sequence of interpolated
// milestones while awaiting it. Each milestone fires at a real-time offset
// that roughly matches the phase of work; when the orchestrator resolves we
// send 100% + result synchronously.
const MILESTONES: Array<{ step: string; pct: number; delayMs: number }> = [
  { step: "Loading financial data...", pct: 5, delayMs: 0 },
  { step: "Building financial projections...", pct: 15, delayMs: 2500 },
  { step: "Computing break-even analysis...", pct: 25, delayMs: 5000 },
  { step: "Building Sources & Uses...", pct: 30, delayMs: 7500 },
  { step: "Writing Executive Summary...", pct: 40, delayMs: 10000 },
  { step: "Writing Industry Analysis...", pct: 50, delayMs: 15000 },
  { step: "Writing Marketing Strategy...", pct: 55, delayMs: 20000 },
  { step: "Writing SWOT Analysis...", pct: 60, delayMs: 25000 },
  { step: "Rendering PDF...", pct: 80, delayMs: 40000 },
  { step: "Cross-filling SBA forms...", pct: 90, delayMs: 55000 },
];

export async function POST(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const sbaGate = await ensureSbaDealOrReturn403(dealId);
  if (sbaGate) return sbaGate;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller may be closed; ignore
        }
      };

      // Schedule milestone heartbeats
      const timers: ReturnType<typeof setTimeout>[] = [];
      let lastMilestonePct = 0;
      for (const m of MILESTONES) {
        const t = setTimeout(() => {
          lastMilestonePct = m.pct;
          send({ step: m.step, pct: m.pct });
        }, m.delayMs);
        timers.push(t);
      }
      // Also tick every 3 seconds while below the last milestone we have
      // reported, nudging pct up by 1% so the progress bar keeps moving.
      const ticker = setInterval(() => {
        if (lastMilestonePct < 95) {
          lastMilestonePct = Math.min(95, lastMilestonePct + 1);
          send({ step: "Generating...", pct: lastMilestonePct });
        }
      }, 3000);

      try {
        const result = await generateSBAPackage(dealId);
        for (const t of timers) clearTimeout(t);
        clearInterval(ticker);

        if (!result.ok) {
          send({ step: "error", pct: 0, error: result.error });
          controller.close();
          return;
        }

        send({
          step: "complete",
          pct: 100,
          result: {
            ok: true,
            packageId: result.packageId,
            dscrBelowThreshold: result.dscrBelowThreshold,
            dscrYear1Base: result.dscrYear1Base,
            pdfUrl: result.pdfUrl,
            versionNumber: result.versionNumber,
          },
        });
        controller.close();
      } catch (err) {
        for (const t of timers) clearTimeout(t);
        clearInterval(ticker);
        send({
          step: "error",
          pct: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
