import "server-only";

import { requireRole } from "@/lib/auth/requireRole";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderMoodysSpread } from "@/lib/financialSpreads/moodys/renderMoodysSpread";
import { renderPrintableSpread } from "@/lib/financialSpreads/print/renderPrintableSpread";
import type { FinancialFact } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MoodysPrintPage(props: {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await props.params;
  const searchParams = (props.searchParams ? await props.searchParams : {}) as Record<
    string,
    string | string[] | undefined
  >;

  // Token auth bypass for Playwright server-side rendering
  const tokenFromQuery = typeof searchParams.token === "string" ? searchParams.token : undefined;
  const tokenFromHeader = (await headers()).get("x-pdf-render-token") ?? undefined;
  const token = tokenFromHeader || tokenFromQuery;
  const secret = process.env.PDF_RENDER_SECRET;

  let bankId: string | undefined;

  if (!token || !secret || token !== secret) {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
  }

  const sb = supabaseAdmin();

  // Load deal info
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_name, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) {
    return <div>Deal not found</div>;
  }

  bankId = deal.bank_id;

  // Load bank info
  const { data: bank } = await sb
    .from("banks")
    .select("id, name")
    .eq("id", bankId)
    .maybeSingle();

  // Load facts
  const { data: facts } = await (sb as any)
    .from("deal_financial_facts")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  const rendered = renderMoodysSpread({
    dealId,
    bankId: bankId!,
    facts: (facts ?? []) as FinancialFact[],
  });

  const html = renderPrintableSpread(rendered, {
    dealName: deal.deal_name ?? "Untitled Deal",
    bankName: bank?.name ?? "—",
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  });

  // Return raw HTML for Playwright to capture
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>Financial Analysis — {deal.deal_name ?? dealId}</title>
      </head>
      <body dangerouslySetInnerHTML={{ __html: html }} />
    </html>
  );
}
