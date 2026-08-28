import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getLatestAssembledPackageRun } from "@/lib/sba/package/getLatestAssembledPackageRun";
import { brokerageColors as c } from "@/components/brokerage/tokens";

/**
 * Pre-seal package review — the whole deal as a bank would receive it.
 *
 * Buddy SBA sells sealed packages to banks. Until the factory has a
 * consistent track record, a human reviews every package before it is
 * sealed, which requires seeing all six deliverables in one place:
 * business plan, feasibility study, projections, financial spreads,
 * credit memo, and the SBA forms package.
 *
 * Deliberately shows artifacts from bundles that FAILED publication.
 * Golden Trident blocks release when institutional review rejects a
 * figure, but it has usually already produced the PDFs by then — 916
 * bundles were marked failed while 16 of them hold real business plans,
 * projections and feasibility studies that no surface could reach. The
 * reviewer needs the artifact and the objection side by side; that is
 * the whole point of the human in the loop.
 *
 * Renders as a server component under /admin/brokerage/*, which
 * requireBrokerageStaffPage() gates in the layout. It signs Storage URLs
 * directly rather than calling /trident/download/[kind], because that
 * dispatcher authenticates a borrower session or a lender access grant —
 * neither of which an internal reviewer has.
 *
 * Adds no route files. The repo is at 1987/2048 Vercel function slots
 * (scripts/count-routes.mjs, error threshold 2017) with a documented
 * history of outages from exceeding the cap, so this mounts on the
 * existing /admin/brokerage/deals page behind ?dealId= rather than
 * taking a new slot.
 */

const SIGNED_URL_TTL_SECONDS = 900;
const TRIDENT_BUCKET = "trident-bundles";
const SBA_FORMS_BUCKET = "bank-forms";

type ArtifactSlot = {
  label: string;
  column: "business_plan_pdf_path" | "projections_pdf_path" | "projections_xlsx_path" | "feasibility_pdf_path";
};

const TRIDENT_ARTIFACTS: ArtifactSlot[] = [
  { label: "Business plan (PDF)", column: "business_plan_pdf_path" },
  { label: "Feasibility study (PDF)", column: "feasibility_pdf_path" },
  { label: "Projections (PDF)", column: "projections_pdf_path" },
  { label: "Projections (XLSX)", column: "projections_xlsx_path" },
];

function Stamp({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const color = ok === null ? c.textMuted : ok ? c.sage : c.brick;
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "1px 7px",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "var(--font-plex-mono), monospace",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Section({
  title,
  status,
  statusOk,
  children,
}: {
  title: string;
  status: string;
  statusOk: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: c.card,
        border: `1px solid ${c.border}`,
        borderRadius: 6,
        marginBottom: 18,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "13px 16px",
          borderBottom: `1px solid ${c.divider}`,
          background: c.inkHeader,
        }}
      >
        <h2 style={{ color: c.paper, fontSize: 15, margin: 0, letterSpacing: "0.01em" }}>{title}</h2>
        <Stamp ok={statusOk}>{status}</Stamp>
      </header>
      <div style={{ padding: "14px 16px" }}>{children}</div>
    </section>
  );
}

function Missing({ what }: { what: string }) {
  return <p style={{ color: c.textMuted, fontSize: 13, margin: 0 }}>{what}</p>;
}

export async function DealPackageReview({ dealId }: { dealId: string }) {
  const sb = supabaseAdmin();

  // Tenant boundary: only brokerage deals are reviewable here, so a stray
  // UUID from another bank cannot be pulled up through this surface.
  let brokerageBankId: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch {
    brokerageBankId = null;
  }

  const { data: deal } = await sb
    .from("deals")
    .select("id, display_name, name, borrower_email, status, stage, created_at, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || (brokerageBankId && deal.bank_id !== brokerageBankId)) {
    return (
      <div style={{ color: c.textSecondary, fontSize: 14 }}>
        <p>No brokerage deal found for that id.</p>
        <Link href="/admin/brokerage/deals" style={{ color: c.brass }}>
          ← Back to deals
        </Link>
      </div>
    );
  }

  // Newest bundle that actually holds artifacts, regardless of status —
  // a blocked bundle is exactly what a reviewer needs to look at. Falls
  // back to the newest bundle of any kind so the objection is still shown
  // when generation failed before writing any file.
  const { data: bundles } = await sb
    .from("buddy_trident_bundles")
    .select(
      "id, status, current_stage, generated_at, generation_error, business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path",
    )
    .eq("deal_id", dealId)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .limit(50);

  const bundleList = bundles ?? [];
  const bundle =
    bundleList.find(
      (b) =>
        b.business_plan_pdf_path || b.projections_pdf_path || b.projections_xlsx_path || b.feasibility_pdf_path,
    ) ?? bundleList[0] ?? null;

  const signed = new Map<string, string>();
  if (bundle) {
    for (const slot of TRIDENT_ARTIFACTS) {
      const path = (bundle as Record<string, unknown>)[slot.column];
      if (typeof path !== "string" || !path) continue;
      const { data } = await sb.storage.from(TRIDENT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (data?.signedUrl) signed.set(slot.column, data.signedUrl);
    }
  }

  const [{ data: spreads }, { data: memoRuns }] = await Promise.all([
    sb
      .from("deal_spreads")
      .select("id, spread_type, status, rendered_html, rendered_json, updated_at")
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false }),
    sb
      .from("memo_runs")
      .select("id, status, created_at, model_name")
      .eq("deal_id", dealId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const latestMemoRun = (memoRuns ?? [])[0] ?? null;
  const { data: memoSections } = latestMemoRun
    ? await sb
        .from("memo_sections")
        .select("section_key, title, content, citations")
        .eq("memo_run_id", latestMemoRun.id)
        .order("created_at", { ascending: true })
    : { data: null };

  const sbaRun = await getLatestAssembledPackageRun(dealId, sb as never).catch(() => null);
  let sbaUrl: string | null = null;
  if (sbaRun) {
    const { data } = await sb.storage
      .from(SBA_FORMS_BUCKET)
      .createSignedUrl(sbaRun.storagePath, SIGNED_URL_TTL_SECONDS);
    sbaUrl = data?.signedUrl ?? null;
  }

  const spreadList = spreads ?? [];
  const sectionList = memoSections ?? [];
  const dealName = deal.display_name || deal.name || dealId.slice(0, 8);

  const readiness = [
    { label: "Business plan", ok: signed.has("business_plan_pdf_path") },
    { label: "Feasibility", ok: signed.has("feasibility_pdf_path") },
    { label: "Projections", ok: signed.has("projections_pdf_path") || signed.has("projections_xlsx_path") },
    { label: "Spreads", ok: spreadList.length > 0 },
    { label: "Credit memo", ok: sectionList.length > 0 },
    { label: "SBA forms", ok: Boolean(sbaUrl) },
  ];
  const completeCount = readiness.filter((r) => r.ok).length;

  return (
    <div style={{ maxWidth: 1080 }}>
      <Link href="/admin/brokerage/deals" style={{ color: c.brass, fontSize: 13, textDecoration: "none" }}>
        ← All brokerage deals
      </Link>

      <h1 style={{ color: c.paper, fontSize: 26, margin: "12px 0 4px" }}>{dealName}</h1>
      <p style={{ color: c.textMuted, fontSize: 13, margin: "0 0 6px" }}>
        Pre-seal review — everything a bank receives in the sealed package.
      </p>
      <p style={{ color: c.textFaint, fontSize: 12, fontFamily: "var(--font-plex-mono), monospace", margin: "0 0 18px" }}>
        {dealId}
        {deal.borrower_email ? ` · ${deal.borrower_email}` : ""}
        {deal.status ? ` · ${deal.status}` : ""}
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "12px 14px",
          background: c.inkHeader,
          border: `1px solid ${c.border}`,
          borderRadius: 6,
          marginBottom: 20,
          alignItems: "center",
        }}
      >
        <strong style={{ color: c.paper, fontSize: 13, marginRight: 4 }}>
          {completeCount}/6 deliverables present
        </strong>
        {readiness.map((r) => (
          <Stamp key={r.label} ok={r.ok}>
            {r.label}
          </Stamp>
        ))}
      </div>

      {bundle?.generation_error ? (
        <div
          style={{
            border: `1px solid ${c.brick}`,
            borderRadius: 6,
            padding: "12px 14px",
            marginBottom: 18,
            background: "rgba(199,127,115,0.07)",
          }}
        >
          <div style={{ color: c.brick, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
            Release blocked by institutional review
            {bundle.current_stage ? ` · stage: ${String(bundle.current_stage).replace(/_/g, " ")}` : ""}
          </div>
          <p style={{ color: c.paper, fontSize: 13, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {bundle.generation_error}
          </p>
          <p style={{ color: c.textMuted, fontSize: 12, margin: "8px 0 0" }}>
            Artifacts below were produced before the block and are shown so the objection can be judged
            against the actual document.
          </p>
        </div>
      ) : null}

      <Section
        title="Golden Trident artifacts"
        status={bundle ? `${signed.size}/4 files` : "no bundle"}
        statusOk={bundle ? signed.size === 4 : null}
      >
        {!bundle ? (
          <Missing what="Golden Trident has never been run for this deal." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {TRIDENT_ARTIFACTS.map((slot) => {
              const url = signed.get(slot.column);
              return (
                <li
                  key={slot.column}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "9px 11px",
                    border: `1px solid ${c.border}`,
                    borderRadius: 4,
                    background: c.ink,
                  }}
                >
                  <span style={{ color: url ? c.paper : c.textMuted, fontSize: 13 }}>{slot.label}</span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: c.brassBright, fontSize: 13, textDecoration: "none" }}
                    >
                      Open ↗
                    </a>
                  ) : (
                    <Stamp ok={false}>not produced</Stamp>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p style={{ color: c.textFaint, fontSize: 11, margin: "10px 0 0" }}>
          Links are signed for 15 minutes. {bundleList.length} bundle
          {bundleList.length === 1 ? "" : "s"} generated for this deal.
        </p>
      </Section>

      <Section
        title="Financial spreads"
        status={spreadList.length ? `${spreadList.length} spread${spreadList.length === 1 ? "" : "s"}` : "none"}
        statusOk={spreadList.length > 0}
      >
        {spreadList.length === 0 ? (
          <Missing what="No spreads have been produced for this deal." />
        ) : (
          spreadList.map((s) => (
            <details key={s.id} style={{ marginBottom: 10 }}>
              <summary style={{ color: c.paper, fontSize: 13, cursor: "pointer" }}>
                {s.spread_type ?? "spread"} · {s.status}
              </summary>
              {s.rendered_html ? (
                <div
                  style={{ overflowX: "auto", marginTop: 10, color: c.paper, fontSize: 12 }}
                  // Spread HTML is produced by Buddy's own deterministic
                  // renderer from governed facts, not by a model and not by
                  // borrower input.
                  dangerouslySetInnerHTML={{ __html: s.rendered_html as string }}
                />
              ) : (
                <p style={{ color: c.textMuted, fontSize: 12, marginTop: 8 }}>
                  No rendered HTML on this spread row.
                </p>
              )}
            </details>
          ))
        )}
      </Section>

      <Section
        title="Credit memo"
        status={sectionList.length ? `${sectionList.length} sections` : "none"}
        statusOk={sectionList.length > 0}
      >
        {sectionList.length === 0 ? (
          <Missing what="No completed memo run for this deal." />
        ) : (
          <>
            <p style={{ color: c.textFaint, fontSize: 11, margin: "0 0 12px" }}>
              Run {latestMemoRun?.id?.slice(0, 8)} · {latestMemoRun?.model_name ?? "model n/a"} ·{" "}
              {latestMemoRun?.created_at ? new Date(latestMemoRun.created_at).toLocaleString() : ""}
            </p>
            {sectionList.map((sec, i) => (
              <details key={`${sec.section_key}-${i}`} style={{ marginBottom: 8 }}>
                <summary style={{ color: c.paper, fontSize: 13, cursor: "pointer" }}>
                  {sec.title || sec.section_key}
                </summary>
                <p
                  style={{
                    color: c.textSecondary,
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    margin: "8px 0 0",
                  }}
                >
                  {sec.content}
                </p>
              </details>
            ))}
          </>
        )}
      </Section>

      <Section title="SBA forms package" status={sbaUrl ? "assembled" : "not assembled"} statusOk={Boolean(sbaUrl)}>
        {sbaUrl ? (
          <a href={sbaUrl} target="_blank" rel="noreferrer" style={{ color: c.brassBright, fontSize: 13 }}>
            Open merged 10-tab package ↗
          </a>
        ) : (
          <Missing what="No assembled SBA package for this deal. The prepare → generate → assemble pipeline is not triggered automatically; it must be run from the SBA action dispatch." />
        )}
      </Section>
    </div>
  );
}
