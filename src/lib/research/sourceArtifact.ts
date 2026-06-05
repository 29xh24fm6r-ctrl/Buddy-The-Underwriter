/**
 * SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1
 *
 * Pure builders for the durable loan-file evidence artifact created from a
 * collected official/public source snapshot. The artifact is a self-contained
 * HTML "evidence receipt" — retrievable later, independent of the live website.
 *
 * Pure module — no server-only, no DB, no fetching. Deterministic given inputs
 * (caller passes capturedAt). Building an artifact NEVER changes committee
 * scoring, never marks committee-grade, never clears a blocker.
 */

export type SourceArtifactInput = {
  dealId: string;
  missionId?: string | null;
  sourceSnapshotId: string;
  taskId?: string | null;
  title: string;
  sourceUrl?: string | null;
  sourceType?: string | null;
  sourceDomain?: string | null;
  connectorKind?: string | null;
  connectorMode?: string | null;
  httpStatus?: number | null;
  contentHash?: string | null;
  capturedAt: string;
  taskTitle?: string | null;
  /** Committee blocker / requirement label this source supports, if known. */
  blockerLabel?: string | null;
  reviewStatus?: string | null;
  limitations?: string[];
  candidateMetadata?: Record<string, unknown> | null;
  /** Captured text snippet, if available (e.g. page <title> / excerpt). */
  excerpt?: string | null;
  createdBy?: string | null;
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label: string, value: unknown): string {
  const v = (value ?? "").toString().trim();
  if (!v) return "";
  return `<tr><th style="text-align:left;padding:4px 12px 4px 0;vertical-align:top;color:#555;white-space:nowrap">${esc(label)}</th><td style="padding:4px 0;vertical-align:top">${esc(v)}</td></tr>`;
}

/**
 * Build the durable HTML evidence receipt. MVP: a structured receipt, NOT a full
 * web-page render. Contains every field the spec requires for committee review.
 */
export function buildSourceArtifactHtml(input: SourceArtifactInput): string {
  const limitations = (input.limitations ?? []).filter(Boolean);
  const meta = input.candidateMetadata && Object.keys(input.candidateMetadata).length > 0
    ? JSON.stringify(input.candidateMetadata)
    : "";
  const urlCell = input.sourceUrl
    ? `<tr><th style="text-align:left;padding:4px 12px 4px 0;color:#555">Source URL</th><td style="padding:4px 0;word-break:break-all"><a href="${esc(input.sourceUrl)}" rel="noopener noreferrer nofollow">${esc(input.sourceUrl)}</a></td></tr>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Captured Public Source Evidence — ${esc(input.title)}</title></head>
<body style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:820px;margin:24px auto;color:#1a1a1a;line-height:1.45">
  <h1 style="font-size:18px;border-bottom:2px solid #1a1a1a;padding-bottom:8px">Captured Public Source Evidence</h1>
  <p style="color:#666;font-size:13px">Captured by Buddy for loan-file evidence review. This is a point-in-time capture; it is advisory and requires analyst review — it does not by itself constitute committee-grade evidence or approval.</p>
  <table style="border-collapse:collapse;font-size:13px;width:100%">
    ${row("Deal", input.dealId)}
    ${input.missionId ? row("Research mission", input.missionId) : ""}
    ${row("Source title", input.title)}
    ${urlCell}
    ${row("Source type", input.sourceType)}
    ${row("Source domain", input.sourceDomain)}
    ${row("Connector", [input.connectorKind, input.connectorMode].filter(Boolean).join(" / "))}
    ${row("Captured at", input.capturedAt)}
    ${row("HTTP status", input.httpStatus)}
    ${row("Content hash (sha256)", input.contentHash)}
    ${row("Committee task", input.taskTitle)}
    ${row("Supports blocker / requirement", input.blockerLabel)}
    ${row("Review status", input.reviewStatus ?? "unreviewed")}
    ${meta ? row("Candidate metadata", meta) : ""}
  </table>
  ${input.excerpt ? `<h2 style="font-size:14px;margin-top:20px">Captured excerpt</h2><blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#333;font-size:13px;white-space:pre-wrap">${esc(input.excerpt)}</blockquote>` : ""}
  ${limitations.length > 0 ? `<h2 style="font-size:14px;margin-top:20px">Limitations</h2><ul style="font-size:13px;color:#444">${limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
  <p style="color:#888;font-size:11px;margin-top:24px">Source snapshot ${esc(input.sourceSnapshotId)}${input.taskId ? ` · task ${esc(input.taskId)}` : ""}. Captured by Buddy for loan-file evidence review.</p>
</body></html>`;
}

export type SourceArtifactRow = {
  deal_id: string;
  mission_id: string | null;
  source_snapshot_id: string;
  task_id: string | null;
  artifact_type: "RESEARCH_SOURCE_SNAPSHOT";
  title: string;
  source_url: string | null;
  source_type: string | null;
  source_domain: string | null;
  connector_kind: string | null;
  connector_mode: string | null;
  http_status: number | null;
  content_hash: string | null;
  captured_at: string;
  status: "captured";
  artifact_html: string;
  excerpt: string | null;
  limitations: string[];
  candidate_metadata: Record<string, unknown>;
  review_status: string | null;
  created_by: string;
};

/** Build the durable artifact DB row (incl. the HTML receipt) for an insert. */
export function buildSourceArtifactRow(input: SourceArtifactInput): SourceArtifactRow {
  return {
    deal_id: input.dealId,
    mission_id: input.missionId ?? null,
    source_snapshot_id: input.sourceSnapshotId,
    task_id: input.taskId ?? null,
    artifact_type: "RESEARCH_SOURCE_SNAPSHOT",
    title: input.title,
    source_url: input.sourceUrl ?? null,
    source_type: input.sourceType ?? null,
    source_domain: input.sourceDomain ?? null,
    connector_kind: input.connectorKind ?? null,
    connector_mode: input.connectorMode ?? null,
    http_status: input.httpStatus ?? null,
    content_hash: input.contentHash ?? null,
    captured_at: input.capturedAt,
    status: "captured",
    artifact_html: buildSourceArtifactHtml(input),
    excerpt: input.excerpt ?? null,
    limitations: input.limitations ?? [],
    candidate_metadata: input.candidateMetadata ?? {},
    review_status: input.reviewStatus ?? null,
    created_by: input.createdBy ?? "buddy_system",
  };
}

/**
 * SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 — Phase 2.
 * The ordered receipt field rows + disclaimer, shared by the HTML receipt and
 * the PDF generator so both render the same evidence content. Pure.
 */
export const SOURCE_ARTIFACT_DISCLAIMER =
  "Captured by Buddy for loan-file evidence review. Requires analyst review; does not by itself constitute committee-grade evidence or approval.";

export function buildSourceArtifactReceiptRows(input: SourceArtifactInput): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown) => {
    const v = (value ?? "").toString().trim();
    if (v) rows.push({ label, value: v });
  };
  add("Deal", input.dealId);
  add("Research mission", input.missionId);
  add("Source title", input.title);
  add("Source URL", input.sourceUrl);
  add("Source type", input.sourceType);
  add("Source domain", input.sourceDomain);
  add("Connector", [input.connectorKind, input.connectorMode].filter(Boolean).join(" / "));
  add("Captured at", input.capturedAt);
  add("HTTP status", input.httpStatus);
  add("Content hash (sha256)", input.contentHash);
  add("Committee task", input.taskTitle);
  add("Supports blocker / requirement", input.blockerLabel);
  add("Review status", input.reviewStatus ?? "unreviewed");
  if (input.candidateMetadata && Object.keys(input.candidateMetadata).length > 0) {
    add("Candidate metadata", JSON.stringify(input.candidateMetadata));
  }
  return rows;
}

/** A friendly artifact title from source type + page title. */
export function sourceArtifactTitle(sourceType: string | null | undefined, pageTitle: string | null | undefined): string {
  const label: Record<string, string> = {
    borrower_official_website: "Captured Source — Borrower Website",
    secretary_of_state: "Captured Source — Secretary of State / Business Registry",
    business_registry: "Captured Source — Business Registry",
    public_adverse_record_search: "Captured Source — Adverse Screen",
    government_data: "Captured Source — Government Data (BLS/Census/FRED)",
    trade_publication: "Captured Source — Trade / Market Source",
    market_research: "Captured Source — Market Research",
    news_primary: "Captured Source — News",
    company_primary: "Captured Source — Competitor / Company",
  };
  const base = label[String(sourceType ?? "")] ?? "Captured Source";
  const t = (pageTitle ?? "").trim();
  return t ? `${base}: ${t.slice(0, 80)}` : base;
}
