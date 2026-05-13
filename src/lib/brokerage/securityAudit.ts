/**
 * BRK-10C Security Audit — pure check functions for borrower/lender/admin boundaries.
 */
export type AuditSeverity = "critical" | "warning" | "info";
export type AuditFinding = { category: string; check: string; severity: AuditSeverity; route: string; message: string; repair: string };
export type SecurityAuditResult = { ok: boolean; total: number; critical: number; warning: number; info: number; findings: AuditFinding[]; elapsed: number };
export type RouteContract = { path: string; methods: string[]; resolvesIdentityServerSide: boolean; acceptsClientBankId: boolean; acceptsClientDealId: boolean };
export type RateLimitSpec = { route: string; hasRateLimit: boolean; limitType: string };
type Row = Record<string, any>;
function finding(cat: string, check: string, sev: AuditSeverity, route: string, msg: string, repair: string): AuditFinding { return { category: cat, check, severity: sev, route, message: msg, repair }; }
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
const SENSITIVE_KEYS = new Set(["token_hash","raw_token","rawToken","tokenHash","service_role_key","supabase_service_role_key","password","secret"]);
function containsSensitiveKey(obj: unknown, seen = new WeakSet()): string | null {
  if (obj == null || typeof obj !== "object") return null;
  if (seen.has(obj as object)) return null; seen.add(obj as object);
  if (Array.isArray(obj)) { for (const i of obj) { const f = containsSensitiveKey(i, seen); if (f) return f; } return null; }
  for (const k of Object.keys(obj as Record<string, any>)) { if (SENSITIVE_KEYS.has(k)) return k; const f = containsSensitiveKey((obj as Record<string, any>)[k], seen); if (f) return f; }
  return null;
}
const PII_PATTERNS: Array<{name:string;regex:RegExp}> = [{name:"email",regex:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i},{name:"phone",regex:/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/},{name:"SSN",regex:/\b\d{3}-\d{2}-\d{4}\b/},{name:"EIN",regex:/\b\d{2}-\d{7}\b/}];
const PII_KFS_KEYS = ["borrowerName","borrowerFirstName","borrowerLastName","businessLegalName","businessDbaName","borrowerEmail","streetAddress","city","zipCode","phoneNumber","ssn","ein"];
const STORAGE_PATTERNS = [/storage_path/i,/storage_bucket/i,/\/trident-bundles\//,/\/sealed-packages\//,/\.pdf$/im,/\.xlsx$/im];

export function auditBorrowerIsolation(args: { sessionA: { tokenHash: string; dealId: string }; sessionB: { tokenHash: string; dealId: string }; resolveSession: (h: string) => { deal_id: string } | null; resolveExpired: (h: string) => { deal_id: string; expires_at: string } | null }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "borrower_isolation";
  const sa = args.resolveSession(args.sessionA.tokenHash);
  if (sa && sa.deal_id === args.sessionB.dealId) r.push(finding(cat, "cross_session_portal", "critical", "portal/[token]", "A resolved to B deal", "Fix session binding"));
  if (sa && sa.deal_id !== args.sessionA.dealId) r.push(finding(cat, "cross_session_pick", "critical", "pick", "Session wrong deal", "Verify deal_id from session"));
  if (args.resolveExpired("expired-token-hash")) r.push(finding(cat, "expired_token", "critical", "session", "Expired token resolved", "Check expires_at"));
  if (args.resolveSession("")) r.push(finding(cat, "malformed_token", "critical", "session", "Empty token resolved", "Reject empty token"));
  if (args.resolveSession("nonexistent-hash-0000")) r.push(finding(cat, "missing_token", "critical", "session", "Unknown hash resolved", "Return null"));
  if (r.length === 0) r.push(finding(cat, "borrower_isolation_ok", "info", "session", "Borrower isolation verified", "None"));
  return r;
}
export function auditLenderIsolation(args: { listings: Row[]; claims: Row[]; agreements: Row[]; banks: Row[] }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "lender_isolation";
  for (const c of args.claims) { const l = args.listings.find(x => x.id === c.listing_id); if (!l) continue; const m = Array.isArray(l.matched_lender_bank_ids) ? l.matched_lender_bank_ids : []; if (!m.includes(String(c.lender_bank_id))) r.push(finding(cat, "unmatched_lender_claim", "critical", "marketplace_claims", `Claim ${c.id}: lender not matched`, "Delete claim")); }
  for (const c of args.claims) { if (str(c.status) !== "active") continue; if (!args.agreements.some(a => a.lender_bank_id === c.lender_bank_id && a.status === "active")) r.push(finding(cat, "claim_without_agreement", "critical", "marketplace_claims", `Claim ${c.id}: no active agreement`, "Suspend claim")); }
  for (const c of args.claims) { const b = args.banks.find(x => x.id === c.lender_bank_id); if (b && str(b.bank_kind) === "brokerage") r.push(finding(cat, "brokerage_bank_claim", "critical", "marketplace_claims", `Claim ${c.id}: brokerage bank`, "Delete claim")); }
  if (r.length === 0) r.push(finding(cat, "lender_isolation_ok", "info", "marketplace", "Lender isolation verified", "None"));
  return r;
}
export function auditPackageAccess(args: { accesses: Row[]; claims: Row[]; picks: Row[]; listings: Row[] }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "package_access"; const pci = new Set(args.picks.filter(p => str(p.status) === "picked").map(p => String(p.claim_id)));
  for (const a of args.accesses) { if (!pci.has(String(a.claim_id))) r.push(finding(cat, "access_not_picked", "critical", "marketplace_package_access", `Access ${a.id}: claim not picked`, "Revoke")); if (a.revoked_at && a.access_level === "full") r.push(finding(cat, "revoked_still_full", "warning", "marketplace_package_access", `Access ${a.id}: revoked but full`, "Set none")); const ms = JSON.stringify(a.metadata ?? {}); for (const p of STORAGE_PATTERNS) { if (p.test(ms)) { r.push(finding(cat, "storage_path_in_access_meta", "critical", "marketplace_package_access", `Access ${a.id}: metadata has storage path`, "Use signed URLs")); break; } } }
  for (const l of args.listings) { if (str(l.status) !== "picked") continue; const ac = args.accesses.filter(a => a.listing_id === l.id && !a.revoked_at).length; if (ac === 0) r.push(finding(cat, "picked_no_access", "critical", "marketplace_listings", `Picked ${l.id}: no access`, "Run unlock")); else if (ac > 1) r.push(finding(cat, "picked_multi_access", "warning", "marketplace_listings", `Picked ${l.id}: ${ac} access grants`, "Revoke dups")); }
  if (r.length === 0) r.push(finding(cat, "package_access_ok", "info", "marketplace", "Package access verified", "None"));
  return r;
}
export function auditRedaction(args: { listings: Row[]; deals: Row[] }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "redaction"; const dm = new Map<string, Row>(); for (const d of args.deals) dm.set(String(d.id), d);
  for (const l of args.listings) { if (["expired","relisted"].includes(str(l.status) ?? "")) continue; const kfs = l.kfs; if (!kfs || typeof kfs !== "object") continue; const ks = JSON.stringify(kfs); const kl = ks.toLowerCase();
    for (const k of PII_KFS_KEYS) { if (k in kfs && kfs[k] != null && String(kfs[k]).length > 0) r.push(finding(cat, `kfs_contains_${k}`, "critical", "marketplace_listings", `Listing ${l.id}: KFS has "${k}"`, "Re-run redactForMarketplace")); }
    for (const { name, regex } of PII_PATTERNS) { if (regex.test(ks)) r.push(finding(cat, `kfs_matches_${name}`, "critical", "marketplace_listings", `Listing ${l.id}: KFS matches ${name}`, "Strip PII")); }
    for (const p of STORAGE_PATTERNS) { if (p.test(ks)) { r.push(finding(cat, "kfs_storage_path", "critical", "marketplace_listings", `Listing ${l.id}: storage path`, "Remove")); break; } }
    const d = dm.get(String(l.deal_id)); if (d) { const bn = str(d.borrower_name); const be = str(d.borrower_email); if (bn && bn.length > 2 && kl.includes(bn.toLowerCase())) r.push(finding(cat, "kfs_leaks_borrower_name", "critical", "marketplace_listings", `Listing ${l.id}: borrower name`, "PII scan")); if (be && kl.includes(be.toLowerCase())) r.push(finding(cat, "kfs_leaks_borrower_email", "critical", "marketplace_listings", `Listing ${l.id}: borrower email`, "PII scan")); } }
  if (r.length === 0) r.push(finding(cat, "redaction_ok", "info", "marketplace_listings", "Redaction verified", "None"));
  return r;
}
export function auditAdminPayloads(args: { payloads: Array<{ source: string; data: unknown }> }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "admin_safety";
  for (const p of args.payloads) { const leaked = containsSensitiveKey(p.data); if (leaked) r.push(finding(cat, "admin_leaks_secret", "critical", p.source, `Contains "${leaked}"`, "Apply stripSecrets")); }
  if (r.length === 0) r.push(finding(cat, "admin_safety_ok", "info", "admin", "No sensitive keys", "None"));
  return r;
}
export function auditApiMethodSafety(args: { routes: RouteContract[] }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "api_safety";
  for (const rt of args.routes) { const isBL = rt.path.includes("/brokerage/") || rt.path.includes("/lender/"); if (isBL && !rt.resolvesIdentityServerSide) r.push(finding(cat, "client_identity_trust", "critical", rt.path, "Trusts client identity", "Resolve server-side")); if (isBL && rt.acceptsClientBankId) r.push(finding(cat, "client_bank_id", "critical", rt.path, "Accepts client bank_id", "Resolve server-side")); if (rt.path.includes("/brokerage/marketplace/") && rt.acceptsClientDealId) r.push(finding(cat, "client_deal_id", "critical", rt.path, "Accepts client deal_id", "Resolve from session")); }
  if (r.length === 0) r.push(finding(cat, "api_safety_ok", "info", "api", "Routes verified", "None"));
  return r;
}
export function auditRateLimits(args: { specs: RateLimitSpec[] }): AuditFinding[] {
  const r: AuditFinding[] = []; const cat = "rate_limit";
  const required = ["/api/brokerage/concierge","/api/brokerage/discovery","/api/brokerage/uploads","/api/lender/marketplace/claim","/api/brokerage/marketplace/pick"];
  for (const rt of required) { const s = args.specs.find(x => x.route === rt); if (!s) { r.push(finding(cat, "missing_rate_limit_spec", "warning", rt, `No spec for ${rt}`, "Add rate limit")); continue; } if (!s.hasRateLimit) r.push(finding(cat, "no_rate_limit", "warning", rt, `No rate limit on ${rt}`, "Add protection")); }
  if (r.length === 0) r.push(finding(cat, "rate_limits_ok", "info", "api", "Rate limits verified", "None"));
  return r;
}
export function runSecurityAudit(args: { borrowerIsolation: Parameters<typeof auditBorrowerIsolation>[0]; lenderIsolation: Parameters<typeof auditLenderIsolation>[0]; packageAccess: Parameters<typeof auditPackageAccess>[0]; redaction: Parameters<typeof auditRedaction>[0]; adminPayloads: Parameters<typeof auditAdminPayloads>[0]; apiMethodSafety: Parameters<typeof auditApiMethodSafety>[0]; rateLimits: Parameters<typeof auditRateLimits>[0]; categories?: string[] }): SecurityAuditResult {
  const start = Date.now(); const all: AuditFinding[] = []; const cats = args.categories ? new Set(args.categories) : null;
  if (!cats || cats.has("borrower")) all.push(...auditBorrowerIsolation(args.borrowerIsolation));
  if (!cats || cats.has("lender")) all.push(...auditLenderIsolation(args.lenderIsolation));
  if (!cats || cats.has("package")) all.push(...auditPackageAccess(args.packageAccess));
  if (!cats || cats.has("redaction")) all.push(...auditRedaction(args.redaction));
  if (!cats || cats.has("admin")) all.push(...auditAdminPayloads(args.adminPayloads));
  if (!cats || cats.has("api")) all.push(...auditApiMethodSafety(args.apiMethodSafety));
  if (!cats || cats.has("rate-limit")) all.push(...auditRateLimits(args.rateLimits));
  all.sort((a, b) => ({critical:0,warning:1,info:2}[a.severity] ?? 2) - ({critical:0,warning:1,info:2}[b.severity] ?? 2));
  const critical = all.filter(f => f.severity === "critical").length;
  return { ok: critical === 0, total: all.length, critical, warning: all.filter(f => f.severity === "warning").length, info: all.filter(f => f.severity === "info").length, findings: all, elapsed: Date.now() - start };
}
