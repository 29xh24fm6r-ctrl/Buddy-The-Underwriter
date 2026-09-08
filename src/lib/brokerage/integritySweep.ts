/**
 * BRK-10A Integrity Sweep — pure check functions + DB runner.
 */
export type IntegritySeverity = "critical" | "warning" | "info";
export type IntegrityIssue = { check: string; severity: IntegritySeverity; table: string; entityId: string | null; message: string; repair: string };
export type IntegritySweepResult = { ok: boolean; total: number; critical: number; warning: number; info: number; issues: IntegrityIssue[]; elapsed: number };
type Row = Record<string, any>;
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function iss(check: string, sev: IntegritySeverity, table: string, eid: string | null, msg: string, rep: string): IntegrityIssue { return { check, severity: sev, table, entityId: eid, message: msg, repair: rep }; }
const PII_KFS = ["borrowerName","borrowerFirstName","borrowerLastName","businessLegalName","businessDbaName","borrowerEmail","streetAddress","city","zipCode","phoneNumber"];
const SPATS = [/storage_path/i,/storage_bucket/i,/\/trident-bundles\//,/\/sealed-packages\//,/\.pdf$/im,/\.xlsx$/im];
export function checkNoTokenHashInPayloads(listings: Row[], portals: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const BK = ["token_hash","rawToken","raw_token","service_role_key"]; for (const l of listings) { const p = JSON.stringify(l); for (const k of BK) if (p.includes(`"${k}"`)) r.push(iss("no_token_hash_in_payloads","critical","marketplace_listings",str(l.id),`Contains "${k}"`, "Strip key")); } for (const ps of portals) { const p = JSON.stringify(ps); for (const k of BK) if (p.includes(`"${k}"`)) r.push(iss("no_token_hash_in_payloads","critical","portal_status",str(ps.deal_id),`Contains "${k}"`, "Strip key")); } return r; }
export function checkClaimAlignment(claims: Row[], listings: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const lm = new Map<string,Row>(); for (const l of listings) lm.set(String(l.id),l); for (const c of claims) { const l = lm.get(String(c.listing_id)); if (!l) { r.push(iss("claim_alignment","critical","marketplace_claims",str(c.id),"Claim refs non-existent listing","Delete orphan")); continue; } if (String(l.deal_id) !== String(c.deal_id)) r.push(iss("claim_alignment","critical","marketplace_claims",str(c.id),`Claim deal ${c.deal_id} != listing deal ${l.deal_id}`,"Fix deal_id")); } return r; }
export function checkPickAlignment(picks: Row[], claims: Row[], listings: Row[]): IntegrityIssue[] { void listings; const r: IntegrityIssue[] = []; const cm = new Map<string,Row>(); for (const c of claims) cm.set(String(c.id),c); for (const p of picks) { const c = cm.get(String(p.claim_id)); if (!c) { r.push(iss("pick_alignment","critical","marketplace_picks",str(p.id),"Pick refs non-existent claim","Delete orphan")); continue; } if (String(c.listing_id) !== String(p.listing_id)) r.push(iss("pick_alignment","critical","marketplace_picks",str(p.id),"Pick listing != claim listing","Fix")); if (String(p.deal_id) !== String(c.deal_id)) r.push(iss("pick_alignment","critical","marketplace_picks",str(p.id),"Pick deal != claim deal","Fix")); if (str(p.picked_lender_bank_id) !== str(c.lender_bank_id)) r.push(iss("pick_alignment","critical","marketplace_picks",str(p.id),"Pick lender != claim lender","Fix")); } return r; }
export function checkAccessAlignment(accesses: Row[], claims: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const cm = new Map<string,Row>(); for (const c of claims) cm.set(String(c.id),c); for (const a of accesses) { const c = cm.get(String(a.claim_id)); if (!c) { r.push(iss("access_alignment","critical","marketplace_package_access",str(a.id),"Refs non-existent claim","Revoke")); continue; } if (str(c.status) !== "picked") r.push(iss("access_alignment","critical","marketplace_package_access",str(a.id),`Non-picked claim (${c.status})`,"Revoke")); if (String(a.deal_id) !== String(c.deal_id)) r.push(iss("access_alignment","critical","marketplace_package_access",str(a.id),"Deal mismatch","Fix")); } return r; }
export function checkNonPickedNoAccess(accesses: Row[], picks: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const pci = new Set(picks.filter(p => str(p.status)==="picked").map(p => String(p.claim_id))); for (const a of accesses) if (!pci.has(String(a.claim_id))) r.push(iss("non_picked_no_access","critical","marketplace_package_access",str(a.id),"Access for non-picked","Revoke")); return r; }
export function checkListingKfsRedacted(listings: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; for (const l of listings) { if (["expired","relisted"].includes(str(l.status)??"")) continue; const kfs = l.kfs; if (!kfs || typeof kfs !== "object") continue; const ks = JSON.stringify(kfs); for (const k of PII_KFS) if (k in kfs && kfs[k] != null && String(kfs[k]).length > 0) r.push(iss("listing_kfs_redacted","critical","marketplace_listings",str(l.id),`KFS has "${k}"`, "Redact")); for (const p of SPATS) if (p.test(ks)) { r.push(iss("listing_kfs_redacted","critical","marketplace_listings",str(l.id),"KFS has storage path","Remove")); break; } } return r; }
export function checkSealedListingUniqueness(sp: Row[], listings: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const m = new Map<string,string[]>(); for (const l of listings) { if (["expired","relisted"].includes(str(l.status)??"")) continue; const d = String(l.deal_id); const a = m.get(d)??[]; a.push(String(l.id)); m.set(d,a); } for (const s of sp) { const a = m.get(String(s.deal_id))??[]; if (a.length > 1) r.push(iss("sealed_listing_uniqueness","warning","buddy_sealed_packages",str(s.id),`${a.length} active listings`,"Expire dups")); } return r; }
export function checkPickedListingAccessCount(listings: Row[], accesses: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const m = new Map<string,number>(); for (const a of accesses) { const l = String(a.listing_id); m.set(l,(m.get(l)??0)+1); } for (const l of listings) { if (str(l.status) !== "picked") continue; const c = m.get(String(l.id))??0; if (c === 0) r.push(iss("picked_listing_access","critical","marketplace_listings",str(l.id),"Zero access grants","Run unlock")); else if (c > 1) r.push(iss("picked_listing_access","warning","marketplace_listings",str(l.id),`${c} access grants`,"Revoke dups")); } return r; }
export function checkDealHasApplication(deals: Row[], concierges: Row[], apps: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const ad = new Set(apps.map(a => String(a.deal_id))); const cd = new Set(concierges.map(c => String(c.deal_id))); for (const d of deals) { const did = String(d.id); if (cd.has(did) && !ad.has(did)) r.push(iss("deal_has_application","warning","deals",did,"Concierge without app","Check propagation")); } return r; }
export function checkScoreCompleteness(scores: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; for (const s of scores) { if (s.score == null) r.push(iss("score_completeness","critical","buddy_sba_scores",str(s.id),"Null score","Recompute")); if (!str(s.band)) r.push(iss("score_completeness","critical","buddy_sba_scores",str(s.id),"Null band","Recompute")); if (s.input_snapshot == null && str(s.score_status) === "locked") r.push(iss("score_completeness","warning","buddy_sba_scores",str(s.id),"Locked null snapshot","Recompute")); } return r; }
export function checkTridentSealAlignment(tridents: Row[], sp: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const m = new Map<string,Row>(); for (const s of sp) m.set(String(s.deal_id),s); for (const t of tridents) { if (str(t.status) !== "succeeded") continue; const s = m.get(String(t.deal_id)); if (!s) continue; if (str(t.bank_id) && str(s.bank_id) && str(t.bank_id) !== str(s.bank_id)) r.push(iss("trident_seal_alignment","critical","buddy_trident_bundles",str(t.id),`Bank mismatch ${t.bank_id} != ${s.bank_id}`,"Investigate")); } return r; }
export function checkUploadDealOwnership(docs: Row[], slots: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const m = new Map<string,string>(); for (const s of slots) if (s.id && s.deal_id) m.set(String(s.id),String(s.deal_id)); for (const d of docs) { if (!d.slot_id) continue; const sd = m.get(String(d.slot_id)); if (sd && String(d.deal_id) !== sd) r.push(iss("upload_deal_ownership","critical","deal_documents",str(d.id),`Doc deal ${d.deal_id} != slot deal ${sd}`,"Detach")); } return r; }
export function checkNoStoragePathInListings(listings: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; for (const l of listings) { if (["expired","relisted"].includes(str(l.status)??"")) continue; const ks = JSON.stringify(l.kfs??{}); for (const p of SPATS) if (p.test(ks)) { r.push(iss("no_storage_path_in_listings","critical","marketplace_listings",str(l.id),"KFS has storage pattern","Remove")); break; } } return r; }
export function checkNoPiiInListingPreview(listings: Row[], deals: Row[]): IntegrityIssue[] { const r: IntegrityIssue[] = []; const dm = new Map<string,Row>(); for (const d of deals) dm.set(String(d.id),d); for (const l of listings) { if (["expired","relisted"].includes(str(l.status)??"")) continue; const ks = JSON.stringify(l.kfs??{}).toLowerCase(); const d = dm.get(String(l.deal_id)); if (!d) continue; const bn = str(d.borrower_name); const be = str(d.borrower_email); if (bn && bn.length > 2 && ks.includes(bn.toLowerCase())) r.push(iss("no_pii_in_listing_preview","critical","marketplace_listings",str(l.id),"Borrower name in KFS","PII scan")); if (be && ks.includes(be.toLowerCase())) r.push(iss("no_pii_in_listing_preview","critical","marketplace_listings",str(l.id),"Borrower email in KFS","PII scan")); } return r; }
export function checkGoldenRunDiagnostics(deal: Row|null, opts: { hasStory: boolean; hasScore: boolean; hasTrident: boolean; sealed: boolean; conciergeProgressPct: number }): IntegrityIssue[] { if (!deal) return []; const r: IntegrityIssue[] = []; if (!opts.hasScore && opts.sealed) r.push(iss("golden_run_diagnostics","critical","deals",String(deal.id),"Sealed without score","Investigate")); return r; }

type IntegritySnapshot = {
  listings: Row[]; claims: Row[]; picks: Row[]; accesses: Row[];
  sealedPackages: Row[]; deals: Row[]; concierges: Row[]; applications: Row[];
  scores: Row[]; tridents: Row[]; documents: Row[]; slots: Row[];
};

const INTEGRITY_TABLES: Record<keyof IntegritySnapshot, string> = {
  listings: "marketplace_listings",
  claims: "marketplace_claims",
  picks: "marketplace_picks",
  accesses: "marketplace_package_access",
  sealedPackages: "buddy_sealed_packages",
  deals: "deals",
  concierges: "borrower_concierge_sessions",
  applications: "borrower_applications",
  scores: "buddy_sba_scores",
  tridents: "buddy_trident_bundles",
  documents: "deal_documents",
  slots: "deal_document_slots",
};

async function loadAllRows(sb: any, table: string): Promise<Row[]> {
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function loadIntegritySnapshot(sb: any): Promise<IntegritySnapshot> {
  const entries = Object.entries(INTEGRITY_TABLES) as Array<[keyof IntegritySnapshot, string]>;
  const loaded = await Promise.all(entries.map(async ([key, table]) => [key, await loadAllRows(sb, table)] as const));
  return Object.fromEntries(loaded) as IntegritySnapshot;
}

export function evaluateIntegritySnapshot(snapshot: IntegritySnapshot): IntegrityIssue[] {
  const listingById = new Map(snapshot.listings.map((row) => [String(row.id), row]));
  // marketplace_claims deliberately has no deal_id. Enrich the in-memory audit
  // view from its canonical listing so alignment checks remain meaningful.
  const claims = snapshot.claims.map((claim) => ({
    ...claim,
    deal_id: claim.deal_id ?? listingById.get(String(claim.listing_id))?.deal_id,
  }));
  return [
    ...checkNoTokenHashInPayloads(snapshot.listings, []),
    ...checkClaimAlignment(claims, snapshot.listings),
    ...checkPickAlignment(snapshot.picks, claims, snapshot.listings),
    ...checkAccessAlignment(snapshot.accesses, claims),
    ...checkNonPickedNoAccess(snapshot.accesses, snapshot.picks),
    ...checkListingKfsRedacted(snapshot.listings),
    ...checkSealedListingUniqueness(snapshot.sealedPackages, snapshot.listings),
    ...checkPickedListingAccessCount(snapshot.listings, snapshot.accesses),
    ...checkDealHasApplication(snapshot.deals, snapshot.concierges, snapshot.applications),
    ...checkScoreCompleteness(snapshot.scores),
    ...checkTridentSealAlignment(snapshot.tridents, snapshot.sealedPackages),
    ...checkUploadDealOwnership(snapshot.documents, snapshot.slots),
    ...checkNoStoragePathInListings(snapshot.listings),
    ...checkNoPiiInListingPreview(snapshot.listings, snapshot.deals),
  ];
}

export async function runIntegritySweep(args: { sb: any }): Promise<IntegritySweepResult> {
  const started = Date.now();
  if (!args?.sb) {
    const issue = iss("integrity_snapshot", "critical", "system", null, "Supabase client is required", "Run the sweep with production database credentials");
    return { ok: false, total: 1, critical: 1, warning: 0, info: 0, issues: [issue], elapsed: Date.now() - started };
  }
  try {
    const issues = evaluateIntegritySnapshot(await loadIntegritySnapshot(args.sb));
    const critical = issues.filter((issue) => issue.severity === "critical").length;
    const warning = issues.filter((issue) => issue.severity === "warning").length;
    const info = issues.filter((issue) => issue.severity === "info").length;
    return { ok: critical === 0, total: issues.length, critical, warning, info, issues, elapsed: Date.now() - started };
  } catch (error) {
    const issue = iss("integrity_snapshot", "critical", "system", null, error instanceof Error ? error.message : String(error), "Repair database access or schema drift, then rerun the sweep");
    return { ok: false, total: 1, critical: 1, warning: 0, info: 0, issues: [issue], elapsed: Date.now() - started };
  }
}
