/**
 * Phase 13C — Deal Timeline Export + Evidence Packet
 *
 * Read-only export of a deal's unified timeline. Produces redacted markdown
 * or JSON evidence packets suitable for sharing with bankers, auditors, or
 * counterparties — without exposing secrets, raw message bodies, or
 * external/storage/provider URLs.
 *
 * Safety contract:
 * - Reads exclusively from getDealTimeline() (already normalized + redacted).
 * - Never touches raw source rows.
 * - Final stringification is scrubbed once more for defense-in-depth.
 */

import {
  getDealTimeline,
  type TimelineActorType,
  type TimelineCategory,
  type TimelineEvent,
  type TimelineSeverity,
} from "./dealTimeline";

// ── Constants ──────────────────────────────────────────────────────────────

export const EXPORT_VERSION = "timeline_export_v1";
export const DEFAULT_EXPORT_LIMIT = 200;
export const MAX_EXPORT_LIMIT = 500;

const REDACTION_NOTICE =
  "This export contains redacted timeline events only. Secrets, raw message bodies, " +
  "full recipient addresses, and external/storage/provider URLs are excluded. " +
  "Internal navigation links may be present.";

// ── Types ──────────────────────────────────────────────────────────────────

export type TimelineExportFormat = "markdown" | "json";

export type TimelineExportOptions = {
  format?: TimelineExportFormat;
  categories?: TimelineCategory[];
  severities?: TimelineSeverity[];
  actorTypes?: TimelineActorType[];
  from?: string;
  to?: string;
  limit?: number;
  includeMetadata?: boolean;
};

export type TimelineExportMetadata = {
  dealId: string;
  generatedAt: string;
  eventCount: number;
  appliedFilters: {
    categories: TimelineCategory[] | null;
    severities: TimelineSeverity[] | null;
    actorTypes: TimelineActorType[] | null;
    from: string | null;
    to: string | null;
    limit: number;
  };
  redactionNotice: string;
  sourceSummary: Record<TimelineCategory, number>;
  exportVersion: string;
};

export type TimelineExportResult = {
  format: TimelineExportFormat;
  body: string;
  metadata: TimelineExportMetadata;
  filename: string;
  contentType: string;
};

type SB = { from: (t: string) => any };

// ── Output-side redaction (defense in depth) ───────────────────────────────

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/re_[A-Za-z0-9_-]{10,}/g, "[REDACTED]"],
  [/KEY[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  [/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [REDACTED]"],
  [/https:\/\/hooks\.slack\.com\/\S+/gi, "[REDACTED_URL]"],
  [/https?:\/\/storage\.googleapis\.com\/\S+/gi, "[REDACTED_URL]"],
  [/gs:\/\/\S+/gi, "[REDACTED_URL]"],
  [/https?:\/\/\S+X-Goog-Signature[^\s"]*/gi, "[REDACTED_URL]"],
  [/https?:\/\/[a-z0-9.-]*\.amazonaws\.com\/\S+/gi, "[REDACTED_URL]"],
  [/https?:\/\/[a-z0-9.-]*\.blob\.core\.windows\.net\/\S+/gi, "[REDACTED_URL]"],
];

function scrubOutput(text: string): string {
  let out = text;
  for (const [pat, sub] of SECRET_PATTERNS) {
    out = out.replace(pat, sub);
  }
  return out;
}

// ── Filename helpers ───────────────────────────────────────────────────────

function safeDealSlug(dealId: string): string {
  const slug = dealId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36);
  return slug || "deal";
}

function timestampSlug(iso: string): string {
  return iso.replace(/[:.]/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
}

export function buildExportFilename(
  dealId: string,
  format: TimelineExportFormat,
  generatedAt: string,
): string {
  const ext = format === "json" ? "json" : "md";
  return `deal-timeline-${safeDealSlug(dealId)}-${timestampSlug(generatedAt)}.${ext}`;
}

export function contentTypeFor(format: TimelineExportFormat): string {
  return format === "json" ? "application/json" : "text/markdown; charset=utf-8";
}

// ── Source summary ─────────────────────────────────────────────────────────

function emptySourceSummary(): Record<TimelineCategory, number> {
  return { document: 0, readiness: 0, comms: 0, banker_action: 0, system: 0 };
}

function summarizeByCategory(events: TimelineEvent[]): Record<TimelineCategory, number> {
  const out = emptySourceSummary();
  for (const e of events) out[e.category] += 1;
  return out;
}

// ── Filter normalization for metadata echo ─────────────────────────────────

const VALID_CATEGORIES = new Set<TimelineCategory>(["document", "readiness", "comms", "banker_action", "system"]);
const VALID_SEVERITIES = new Set<TimelineSeverity>(["info", "success", "warning", "error"]);
const VALID_ACTOR_TYPES = new Set<TimelineActorType>(["borrower", "banker", "system", "provider"]);

function cleanList<T>(arr: T[] | undefined, valid: Set<T>): T[] | null {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
  const filtered = arr.filter((v) => valid.has(v));
  return filtered.length > 0 ? filtered : null;
}

function isValidIsoString(v: string | undefined): boolean {
  if (!v) return false;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms);
}

// ── Public formatters ──────────────────────────────────────────────────────

export function formatTimelineExportJson(
  events: TimelineEvent[],
  metadata: TimelineExportMetadata,
): string {
  const payload = { metadata, events };
  return scrubOutput(JSON.stringify(payload, null, 2));
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatDayHeader(date: string): string {
  return `### ${date}`;
}

function formatEventLine(e: TimelineEvent): string {
  const time = e.timestamp.slice(11, 16); // HH:MM (UTC)
  const sev = e.severity.toUpperCase();
  const cat = e.category;
  const actor = e.actorType;
  const title = mdEscape(e.title || "(untitled)");
  const desc = e.description ? ` — ${mdEscape(e.description)}` : "";
  const href = e.href ? ` ([source](${e.href}))` : "";
  return `- **${time}Z** \`${cat}/${sev}/${actor}\` ${title}${desc}${href}`;
}

function groupByDay(events: TimelineEvent[]): Array<{ date: string; events: TimelineEvent[] }> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const date = e.timestamp.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(e);
  }
  const out: Array<{ date: string; events: TimelineEvent[] }> = [];
  for (const [date, evts] of groups) out.push({ date, events: evts });
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

export function formatTimelineExportMarkdown(
  events: TimelineEvent[],
  metadata: TimelineExportMetadata,
): string {
  const lines: string[] = [];
  lines.push(`# Deal Timeline Export`);
  lines.push("");
  lines.push(`**Deal ID:** \`${metadata.dealId}\`  `);
  lines.push(`**Generated:** ${metadata.generatedAt}  `);
  lines.push(`**Events:** ${metadata.eventCount}  `);
  lines.push(`**Export version:** ${metadata.exportVersion}`);
  lines.push("");
  lines.push(`> ${metadata.redactionNotice}`);
  lines.push("");

  // Applied filters
  const f = metadata.appliedFilters;
  lines.push(`## Applied filters`);
  lines.push("");
  lines.push(`- Categories: ${f.categories ? f.categories.join(", ") : "all"}`);
  lines.push(`- Severities: ${f.severities ? f.severities.join(", ") : "all"}`);
  lines.push(`- Actor types: ${f.actorTypes ? f.actorTypes.join(", ") : "all"}`);
  lines.push(`- From: ${f.from ?? "(none)"}`);
  lines.push(`- To: ${f.to ?? "(none)"}`);
  lines.push(`- Limit: ${f.limit}`);
  lines.push("");

  // Source summary
  lines.push(`## Source summary`);
  lines.push("");
  const s = metadata.sourceSummary;
  lines.push(`| Category | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| document | ${s.document} |`);
  lines.push(`| readiness | ${s.readiness} |`);
  lines.push(`| comms | ${s.comms} |`);
  lines.push(`| banker_action | ${s.banker_action} |`);
  lines.push(`| system | ${s.system} |`);
  lines.push("");

  // Events grouped by day
  lines.push(`## Events`);
  lines.push("");
  if (events.length === 0) {
    lines.push(`_No events matched the requested filters._`);
    lines.push("");
  } else {
    const groups = groupByDay(events);
    for (const g of groups) {
      lines.push(formatDayHeader(g.date));
      lines.push("");
      for (const e of g.events) lines.push(formatEventLine(e));
      lines.push("");
    }
  }

  return scrubOutput(lines.join("\n"));
}

// ── Public entrypoint ──────────────────────────────────────────────────────

export async function buildDealTimelineExport(
  dealId: string,
  sb: SB,
  opts?: TimelineExportOptions,
): Promise<TimelineExportResult> {
  const format: TimelineExportFormat = opts?.format === "json" ? "json" : "markdown";

  const requestedLimit = typeof opts?.limit === "number" && Number.isFinite(opts.limit)
    ? Math.floor(opts.limit)
    : DEFAULT_EXPORT_LIMIT;
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_EXPORT_LIMIT);

  const cleanCats = cleanList(opts?.categories, VALID_CATEGORIES);
  const cleanSevs = cleanList(opts?.severities, VALID_SEVERITIES);
  const cleanActors = cleanList(opts?.actorTypes, VALID_ACTOR_TYPES);
  const cleanFrom = isValidIsoString(opts?.from) ? opts!.from! : null;
  const cleanTo = isValidIsoString(opts?.to) ? opts!.to! : null;

  // getDealTimeline caps internally at 200; for evidence-packet exports we
  // walk the same normalized pipeline twice if the caller asked for >200.
  // To stay strictly within the safety contract (normalized output only),
  // call once and trust the cap chain: 500 (here) → 200 (timeline) → events.
  const events = await getDealTimeline(dealId, sb, {
    limit,
    categories: cleanCats ?? undefined,
    severities: cleanSevs ?? undefined,
    actorTypes: cleanActors ?? undefined,
    from: cleanFrom ?? undefined,
    to: cleanTo ?? undefined,
    newestFirst: true,
  });

  const generatedAt = new Date().toISOString();
  const metadata: TimelineExportMetadata = {
    dealId,
    generatedAt,
    eventCount: events.length,
    appliedFilters: {
      categories: cleanCats,
      severities: cleanSevs,
      actorTypes: cleanActors,
      from: cleanFrom,
      to: cleanTo,
      limit,
    },
    redactionNotice: REDACTION_NOTICE,
    sourceSummary: summarizeByCategory(events),
    exportVersion: EXPORT_VERSION,
  };

  const includeMeta = opts?.includeMetadata !== false;
  const metaForOutput: TimelineExportMetadata = includeMeta
    ? metadata
    : {
        ...metadata,
        // Always keep redactionNotice + exportVersion for auditability even
        // when caller asked to omit metadata in the human-readable header.
        appliedFilters: metadata.appliedFilters,
        sourceSummary: metadata.sourceSummary,
      };

  const body = format === "json"
    ? formatTimelineExportJson(events, metaForOutput)
    : formatTimelineExportMarkdown(events, metaForOutput);

  return {
    format,
    body,
    metadata,
    filename: buildExportFilename(dealId, format, generatedAt),
    contentType: contentTypeFor(format),
  };
}
