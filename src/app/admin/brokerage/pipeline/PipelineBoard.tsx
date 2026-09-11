"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { crmColors as c } from "@/components/brokerage/tokens";
import {
  BOARD_COLUMNS,
  INTAKE_MODE_LABELS,
  STAGE_LABELS,
  boardLabelForStage,
  columnForStage,
  daysInStage,
  isStalled,
  type BoardColumnId,
} from "@/lib/dealStage/board";
import type { BrokerageTeamMember } from "@/lib/brokerage/team";

export type PipelineDeal = {
  id: string;
  title: string;
  borrower: string | null;
  amount: number | null;
  state: string | null;
  productType: string | null;
  stage: string | null;
  stageEnteredAt: string | null;
  ownerClerkUserId: string | null;
  intakeMode: string | null;
  createdAt: string | null;
  archivedAt: string | null;
  banksSent: number;
  banksReviewing: number;
  banksAdvanced: number;
  banksDeclined: number;
  nextTask: { title: string; dueAt: string | null } | null;
};

type OwnerFilter = "all" | "mine" | "unassigned" | string;

function money(amount: number | null): string {
  if (!amount) return "—";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

const control: React.CSSProperties = {
  background: c.inkHeader,
  border: `1px solid ${c.border}`,
  borderRadius: 5,
  padding: "7px 10px",
  color: c.paper,
  fontSize: 12,
};

function Chip({ label, tone }: { label: string; tone: "neutral" | "good" | "warn" | "bad" }) {
  const color = tone === "good" ? c.sage : tone === "bad" ? c.brick : tone === "warn" ? c.brassBright : c.textMuted;
  return (
    <span
      style={{
        fontFamily: "var(--font-brokerage-mono)",
        fontSize: 9.5,
        letterSpacing: ".04em",
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "1px 5px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/**
 * The board. Filters live in component state rather than a data refetch —
 * the whole book of business is a few hundred rows, and a broker changing
 * "show me mine" should not wait on a round trip.
 *
 * Assignment posts to PATCH /api/admin/brokerage/deals/[id]/execution, the
 * endpoint that has existed and been unreachable since the stage machine
 * shipped.
 */
export default function PipelineBoard({
  deals,
  team,
  currentUserId,
  loadError = null,
  showArchived = false,
}: {
  deals: PipelineDeal[];
  team: BrokerageTeamMember[];
  currentUserId: string | null;
  /** Set when the deals query itself failed — never show an empty board for it. */
  loadError?: string | null;
  showArchived?: boolean;
}) {
  const params = useSearchParams();
  const [rows, setRows] = useState(deals);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>(params.get("owner") === "unassigned" ? "unassigned" : "all");
  const [intake, setIntake] = useState("all");
  const [onlyAttention, setOnlyAttention] = useState(params.get("attention") === "1");
  const [view, setView] = useState<"board" | "list">("board");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<{ dealId: string; title: string; previous: string | null } | null>(null);
  const [expandedColumns, setExpandedColumns] = useState<Set<BoardColumnId>>(new Set());

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (owner === "unassigned") {
        if (d.ownerClerkUserId) return false;
      } else if (owner !== "all") {
        const target = owner === "mine" ? currentUserId : owner;
        if (!target || d.ownerClerkUserId !== target) return false;
      }
      if (intake !== "all" && (d.intakeMode ?? "unspecified") !== intake) return false;
      if (onlyAttention && !(isStalled(d.stage, d.stageEnteredAt) || !d.nextTask || !d.ownerClerkUserId)) return false;
      if (q && ![d.title, d.borrower, d.state, d.productType].some((v) => v && String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, owner, intake, onlyAttention, currentUserId]);

  const byColumn = useMemo(() => {
    const map = new Map<BoardColumnId, PipelineDeal[]>();
    for (const column of BOARD_COLUMNS) map.set(column.id, []);
    for (const deal of visible) map.get(columnForStage(deal.stage))!.push(deal);
    return map;
  }, [visible]);

  async function assign(dealId: string, ownerClerkUserId: string | null, announce = true) {
    setAssigning(dealId);
    setError(null);
    const previous = rows;
    setRows((current) => current.map((d) => (d.id === dealId ? { ...d, ownerClerkUserId } : d)));
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${dealId}/execution`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerClerkUserId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not assign the deal.");
      if (announce) {
        const changed = previous.find((deal) => deal.id === dealId);
        if (changed) setAssignmentNotice({ dealId, title: changed.title, previous: changed.ownerClerkUserId });
      }
      return true;
    } catch (e) {
      setRows(previous);
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setAssigning(null);
    }
  }

  async function rescueSelected(action: "assign" | "plan") {
    if (!selected.length || bulkBusy) return;
    if (action === "assign" && !bulkOwner) { setError("Choose the teammate who will own the selected deals."); return; }
    setBulkBusy(true); setError(null);
    const failures: string[] = [];
    for (const dealId of selected) {
      const deal = rows.find((row) => row.id === dealId);
      if (!deal) continue;
      const endpoint = action === "assign" ? `/api/admin/brokerage/deals/${dealId}/execution` : `/api/admin/brokerage/deals/${dealId}/execution/actions`;
      const body = action === "assign" ? { ownerClerkUserId: bulkOwner } : { action: "generate_stage_plan", stage: deal.stage ?? "intake" };
      try {
        const response = await fetch(endpoint, { method: action === "assign" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "Update was not confirmed");
        if (action === "assign") setRows((current) => current.map((row) => row.id === dealId ? { ...row, ownerClerkUserId: bulkOwner } : row));
      } catch { failures.push(deal.title); }
    }
    setBulkBusy(false);
    if (failures.length) setError(`${selected.length - failures.length} of ${selected.length} updates confirmed. Review: ${failures.join(", ")}.`);
    else { setSelected([]); if (action === "plan") window.location.reload(); }
  }

  const toggleSelected = (dealId: string) => setSelected((current) => current.includes(dealId) ? current.filter((id) => id !== dealId) : [...current, dealId]);

  const attentionCount = rows.filter(
    (d) => isStalled(d.stage, d.stageEnteredAt) || !d.nextTask || !d.ownerClerkUserId,
  ).length;
  const flowReadyCount = rows.filter(
    (d) => d.ownerClerkUserId && d.nextTask && !isStalled(d.stage, d.stageEnteredAt),
  ).length;
  const flowPercent = rows.length ? Math.round((flowReadyCount / rows.length) * 100) : 100;

  function OwnerPicker({ deal }: { deal: PipelineDeal }) {
    return (
      <select
        aria-label={`Owner for ${deal.title}`}
        value={deal.ownerClerkUserId ?? ""}
        disabled={showArchived || assigning === deal.id}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          void assign(deal.id, e.target.value || null);
        }}
        style={{
          background: "transparent",
          border: `1px solid ${deal.ownerClerkUserId ? c.border : c.brick}`,
          borderRadius: 4,
          color: deal.ownerClerkUserId ? c.textSecondary : c.brick,
          fontSize: 10.5,
          padding: "2px 4px",
          maxWidth: 128,
        }}
      >
        <option value="">Unassigned</option>
        {team.map((m) => (
          <option key={m.clerkUserId} value={m.clerkUserId}>{m.name}</option>
        ))}
      </select>
    );
  }

  function Card({ deal }: { deal: PipelineDeal }) {
    const age = daysInStage(deal.stageEnteredAt);
    const stalled = isStalled(deal.stage, deal.stageEnteredAt);
    return (
      <div
        style={{
          background: c.card,
          border: `1px solid ${stalled ? "rgba(199,127,115,.45)" : c.border}`,
          borderLeft: `3px solid ${stalled ? c.brick : c.borderStrong}`,
          borderRadius: 6,
          padding: "10px 11px",
          display: "grid",
          gap: 7,
        }}
      >
        {!showArchived ? <label style={{ display: "flex", gap: 7, alignItems: "center", color: c.textMuted, fontSize: 10 }}>
          <input type="checkbox" checked={selected.includes(deal.id)} onChange={() => toggleSelected(deal.id)} /> Select for rescue
        </label> : null}
        <Link href={`/admin/brokerage/pipeline/${deal.id}`} style={{ textDecoration: "none", display: "grid", gap: 3 }}>
          <span style={{ color: c.paper, fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{deal.title}</span>
          <span style={{ color: c.textMuted, fontSize: 10.5 }}>
            {deal.borrower ?? "No borrower recorded"}
            {deal.state ? ` · ${deal.state}` : ""}
          </span>
        </Link>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 13, color: c.brassBright }}>{money(deal.amount)}</span>
          <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10, color: stalled ? c.brick : c.textFaint }}>
            {age === null ? "—" : `${age}d in ${boardLabelForStage(deal.stage)} · ${STAGE_LABELS[deal.stage ?? ""] ?? "Intake"}`}
          </span>
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {deal.intakeMode && <Chip label={INTAKE_MODE_LABELS[deal.intakeMode] ?? deal.intakeMode} tone="neutral" />}
          {deal.banksSent > 0 && <Chip label={`${deal.banksSent} sent`} tone="neutral" />}
          {deal.banksReviewing > 0 && <Chip label={`${deal.banksReviewing} reviewing`} tone="warn" />}
          {deal.banksAdvanced > 0 && <Chip label={`${deal.banksAdvanced} advanced`} tone="good" />}
          {deal.banksDeclined > 0 && <Chip label={`${deal.banksDeclined} declined`} tone="bad" />}
          {deal.banksSent === 0 && <Chip label="No bank yet" tone="neutral" />}
        </div>

        <div style={{ fontSize: 10.5, color: deal.nextTask ? c.textSecondary : c.brick }}>
          {deal.nextTask
            ? `Next: ${deal.nextTask.title}${deal.nextTask.dueAt ? ` · ${new Date(deal.nextTask.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
            : "No next action"}
        </div>

        <div style={{ display: "grid", gap: 3 }}>
          <small style={{ color: c.textFaint, fontSize: 9.5 }}>Owner · saves now, with Undo</small>
          <OwnerPicker deal={deal} />
        </div>
      </div>
    );
  }

  return (
    <div className="sba-work-surface sba-pipeline" style={{ padding: "24px 28px 48px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 22 }}>Pipeline</h1>
          <p style={{ margin: "4px 0 0", color: c.textMuted, fontSize: 12 }}>
            {rows.length} {showArchived ? "archived" : "open"} deal{rows.length === 1 ? "" : "s"}
            {!showArchived && attentionCount > 0 && <span style={{ color: c.brick }}> · {attentionCount} need attention</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={showArchived ? "/admin/brokerage/pipeline" : "/admin/brokerage/pipeline?view=archived"} style={{ ...control, textDecoration: "none", color: c.textSecondary }}>
            {showArchived ? "Active deals" : "Archived deals"}
          </Link>
          {!showArchived ? <>
          <Link href="/admin/brokerage/pipeline/queues" style={{ ...control, textDecoration: "none", color: c.textSecondary }}>
            My work →
          </Link>
          <Link
            href="/admin/brokerage/pipeline/new"
            style={{ ...control, textDecoration: "none", background: c.brass, color: c.brassOnBrass, fontWeight: 700, border: "none" }}
          >
            + Load a deal
          </Link>
          </> : null}
        </div>
      </div>

      {!showArchived ? (
        <section className="sba-flow-pulse" aria-label="Pipeline flow health">
          <div className="sba-flow-orbit" style={{ "--flow": `${flowPercent * 3.6}deg` } as React.CSSProperties}><strong>{flowPercent}<small>%</small></strong></div>
          <div className="sba-flow-copy"><span>PIPELINE FLOW</span><h2>{flowPercent === 100 ? "Everything is ready to move." : `${flowReadyCount} of ${rows.length} deals are ready to move.`}</h2><p>Real momentum: every ready deal has an owner, a next action, and no stalled stage.</p></div>
          <div className="sba-flow-stats"><span><b>{rows.length - flowReadyCount}</b> to unlock</span><span><b>{rows.length - attentionCount}</b> clear</span><span><b>{flowReadyCount}</b> moving</span></div>
        </section>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          aria-label="Search deals"
          placeholder="Search business, borrower, state…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...control, minWidth: 230, flex: "1 1 230px" }}
        />
        <select aria-label="Filter by owner" value={owner} onChange={(e) => setOwner(e.target.value)} style={control}>
          <option value="all">Everyone</option>
          {currentUserId && <option value="mine">Mine</option>}
          <option value="unassigned">Unassigned</option>
          {team.map((m) => (
            <option key={m.clerkUserId} value={m.clerkUserId}>{m.name}</option>
          ))}
        </select>
        <select aria-label="Filter by how the deal arrived" value={intake} onChange={(e) => setIntake(e.target.value)} style={control}>
          <option value="all">Any source</option>
          {Object.entries(INTAKE_MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
          <option value="unspecified">Unspecified</option>
        </select>
        {!showArchived ? <button
          type="button"
          onClick={() => setOnlyAttention((v) => !v)}
          style={{
            ...control,
            cursor: "pointer",
            borderColor: onlyAttention ? c.brick : c.border,
            color: onlyAttention ? c.brick : c.textSecondary,
          }}
        >
          Needs attention
        </button> : null}
        <button
          type="button"
          onClick={() => setView((v) => (v === "board" ? "list" : "board"))}
          style={{ ...control, cursor: "pointer", color: c.textSecondary }}
        >
          {view === "board" ? "List view" : "Board view"}
        </button>
      </div>

      {!showArchived && selected.length > 0 && (
        <section aria-label="Selected deal rescue actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 12, marginBottom: 14, border: `1px solid ${c.brass}`, borderRadius: 7, background: "rgba(184,130,63,.08)" }}>
          <strong style={{ color: c.paper, fontSize: 12 }}>{selected.length} selected</strong>
          <select aria-label="Bulk owner" value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} style={control}><option value="">Choose owner…</option>{team.map((member) => <option key={member.clerkUserId} value={member.clerkUserId}>{member.name}</option>)}</select>
          <button type="button" disabled={bulkBusy || !bulkOwner} onClick={() => void rescueSelected("assign")} style={control}>Assign owner</button>
          <button type="button" disabled={bulkBusy} onClick={() => void rescueSelected("plan")} style={control}>Create stage task plan</button>
          <button type="button" disabled={bulkBusy} onClick={() => setSelected([])} style={{ ...control, marginLeft: "auto" }}>Clear</button>
          <small style={{ width: "100%", color: c.textMuted }}>Each update is confirmed individually. Failed records remain visible for review.</small>
        </section>
      )}

      {(error || loadError) && (
        <div role="alert" style={{ border: `1px solid ${c.brick}`, color: c.brick, borderRadius: 6, padding: 11, fontSize: 12, marginBottom: 14 }}>
          {error ?? `The pipeline could not be loaded: ${loadError}`}
        </div>
      )}

      {assignmentNotice && !error && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${c.sage}`, background: "rgba(83,166,134,.1)", color: c.textSecondary, borderRadius: 6, padding: 11, fontSize: 12, marginBottom: 14 }}>
          <span style={{ flex: 1 }}>Owner updated for <strong style={{ color: c.paper }}>{assignmentNotice.title}</strong>.</span>
          <button type="button" disabled={assigning === assignmentNotice.dealId} onClick={() => void assign(assignmentNotice.dealId, assignmentNotice.previous, false).then((ok) => { if (ok) setAssignmentNotice(null); })} style={{ ...control, cursor: "pointer", color: c.sage }}>Undo</button>
          <button type="button" aria-label="Dismiss owner update" onClick={() => setAssignmentNotice(null)} style={{ ...control, cursor: "pointer" }}>✕</button>
        </div>
      )}

      {view === "board" ? (
        <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(258px, 1fr)", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
          {BOARD_COLUMNS.map((column) => {
            const columnDeals = byColumn.get(column.id) ?? [];
            const filtered = !!search.trim() || owner !== "all" || intake !== "all" || onlyAttention;
            const orderedDeals = [...columnDeals].sort((a, b) => {
              const priority = (deal: PipelineDeal) => (!deal.ownerClerkUserId ? 4 : 0) + (!deal.nextTask ? 3 : 0) + (isStalled(deal.stage, deal.stageEnteredAt) ? 2 : 0);
              return priority(b) - priority(a) || (b.amount ?? 0) - (a.amount ?? 0);
            });
            const expanded = filtered || expandedColumns.has(column.id);
            const displayedDeals = expanded ? orderedDeals : orderedDeals.slice(0, 6);
            const hiddenCount = orderedDeals.length - displayedDeals.length;
            const columnValue = columnDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
            return (
              <section key={column.id} style={{ display: "grid", gap: 9, alignContent: "start" }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 2px 7px", borderBottom: `1px solid ${c.border}` }}>
                  <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: c.textSecondary }}>
                    {column.label} · {columnDeals.length}
                  </span>
                  <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10.5, color: c.textFaint }}>{money(columnValue)}</span>
                </header>
                {columnDeals.length === 0 ? (
                  <p style={{ margin: 0, padding: "14px 4px", color: c.textFaint, fontSize: 11, lineHeight: 1.5 }}>{column.emptyHint}</p>
                ) : (
                  displayedDeals.map((deal) => <Card key={deal.id} deal={deal} />)
                )}
                {hiddenCount > 0 ? <button type="button" onClick={() => setExpandedColumns((current) => new Set([...current, column.id]))} style={{ ...control, cursor: "pointer", color: c.brassBright }}>Show {hiddenCount} more</button> : null}
                {!filtered && expanded && orderedDeals.length > 6 ? <button type="button" onClick={() => setExpandedColumns((current) => { const next = new Set(current); next.delete(column.id); return next; })} style={{ ...control, cursor: "pointer", color: c.textMuted }}>Show priorities only</button> : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          {visible.length === 0 ? (
            <p style={{ margin: 0, padding: "48px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>
              No deals match these filters.
            </p>
          ) : (
            visible.map((deal) => (
              <div
                key={deal.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.6fr) 110px 150px 110px minmax(0,1fr) 140px",
                  gap: 14,
                  alignItems: "center",
                  padding: "11px 16px",
                  borderBottom: `1px solid ${c.divider}`,
                }}
              >
                <Link href={`/admin/brokerage/pipeline/${deal.id}`} style={{ textDecoration: "none", minWidth: 0 }}>
                  <div style={{ color: c.paper, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.title}</div>
                  <div style={{ color: c.textMuted, fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.borrower ?? "—"}</div>
                </Link>
                <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: c.brassBright, textAlign: "right" }}>{money(deal.amount)}</div>
                <div style={{ fontSize: 11, color: c.textSecondary }}>{STAGE_LABELS[deal.stage ?? ""] ?? "Unstaged"}</div>
                <div style={{ fontSize: 11, color: c.textMuted }}>
                  {deal.banksSent > 0 ? `${deal.banksSent} bank${deal.banksSent === 1 ? "" : "s"}` : "No bank"}
                </div>
                <div style={{ fontSize: 11, color: deal.nextTask ? c.textSecondary : c.brick, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {deal.nextTask?.title ?? "No next action"}
                </div>
                <OwnerPicker deal={deal} />
              </div>
            ))
          )}
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ padding: "54px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>{loadError ? "!" : "▦"}</div>
          <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: loadError ? c.brick : "#C9C3B6", marginBottom: 4 }}>
            {loadError ? "The pipeline could not be loaded" : showArchived ? "No archived deals" : "No deals in the pipeline"}
          </div>
          <div style={{ fontSize: 12, color: c.textMuted }}>
            {loadError ?? (showArchived ? "Deals you archive will be safely kept here." : "Load one by hand, or wait for the next referral to arrive.")}
          </div>
        </div>
      )}

      <p style={{ marginTop: 16, color: c.textFaint, fontSize: 10.5 }}>
        {showArchived ? "Open an archived deal to restore it or, if you are an admin, permanently remove an accidental record." : "Priority view shows the deals most likely to stall first. Filters always show every match."}
      </p>
    </div>
  );
}
