import "server-only";

const BORROWER_ALLOWED_SCOPES = new Set([
  "doc_intel",
  "borrower_checklist",
  "portal_guided_upload",
  "ownership_portal", // only if you choose to expose owner % evidence safely
]);

export function isBorrowerSafeScope(scope: string) {
  return BORROWER_ALLOWED_SCOPES.has(String(scope || ""));
}

export function sanitizeEvidenceEvent(ev: any) {
  // hard-strip any internal info
  return {
    id: ev.id,
    scope: ev.scope,
    action: ev.action,
    confidence: ev.confidence ?? null,
    created_at: ev.created_at,
    // evidence_json is allowed but we prune any risky keys
    evidence_json: sanitizeEvidenceJson(ev.evidence_json),
    // do NOT return full output_json to borrowers
  };
}

function sanitizeEvidenceJson(e: any) {
  if (!e || typeof e !== "object") return null;

  const out: any = {};

  // allow only spans + simple notes
  if (Array.isArray(e.evidence_spans)) {
    out.evidence_spans = e.evidence_spans.slice(0, 3).map((s: any) => ({
      attachment_id: String(s.attachment_id || ""),
      start: Number(s.start || 0),
      end: Number(s.end || 0),
      label: s.label ? String(s.label).slice(0, 120) : null,
      confidence: s.confidence ?? null,
    }));
  }

  if (Array.isArray(e.evidence)) {
    out.evidence = e.evidence.slice(0, 8).map((x: any) => ({
      kind: x.kind ? String(x.kind).slice(0, 40) : "note",
      note: x.note ? String(x.note).slice(0, 220) : "",
    }));
  }

  return out;
}
