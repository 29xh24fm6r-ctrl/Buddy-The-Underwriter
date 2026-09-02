"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCrmWorkspace } from "./CrmWorkspaceFrame";
import {
  humanLabel,
  leadTitle,
  type LeadSnapshot,
} from "@/lib/crm/workspaceModel";
import {
  ALLOWED_TRANSITIONS,
  LEAD_STAGES,
  type LeadStage,
} from "@/lib/leads/stages";
import { confirmCrmDiscard, useCrmDraftGuard } from "./useCrmDraftGuard";

type Lead = LeadSnapshot & {
  priority: string;
  owner_clerk_user_id: string | null;
  phone: string | null;
  source: string | null;
};
type Member = {
  clerkUserId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};
const queues = [
  ["all", "All opportunities"],
  ["my_leads", "My leads"],
  ["unassigned", "Needs an owner"],
  ["overdue_follow_up", "Overdue follow-ups"],
  ["no_contact_attempted", "First conversation"],
  ["stale", "Needs attention"],
  ["qualified_not_converted", "Ready to progress"],
  ["nurture", "Nurture"],
  ["recently_converted", "Recently converted"],
  ["lost_and_disqualified", "Closed leads"],
];
const stages: readonly string[] = LEAD_STAGES;

export function CrmLeadWorkbench() {
  const params = useSearchParams();
  const workspace = useCrmWorkspace();
  const requested = params.get("queue");
  const [queue, setQueue] = useState(
    queues.some(([id]) => id === requested) ? requested! : "all",
  );
  const [view, setView] = useState("board");
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [newLead, setNewLead] = useState(params.get("new") === "1");
  const [selected, setSelected] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [bulk, setBulk] = useState("assign");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refresh = () => {
    setRevision((n) => n + 1);
    workspace?.refresh();
  };
  const requestKey = `${queue}:${revision}:${workspace?.revision || 0}`;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/brokerage/crm/leads?queue=${queue}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        if (!controller.signal.aborted) {
          setLeads(j.leads || []);
          setSelected([]);
          setError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLeads([]);
          setError("This queue could not be loaded. Please refresh.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(requestKey);
      });
    return () => controller.abort();
  }, [queue, requestKey]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/brokerage/team", { signal: controller.signal })
      .then(async (r) => {
        const j = await r.json();
        if (r.ok && j.ok && !controller.signal.aborted) setTeam(j.team || []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const ownerName = (id: string | null) => {
    const member = team.find((m) => m.clerkUserId === id);
    return member
      ? [member.firstName, member.lastName].filter(Boolean).join(" ") ||
          member.email ||
          "Teammate"
      : id
        ? "Assigned teammate"
        : "Unassigned";
  };
  const filtered = leads.filter((l) =>
    [leadTitle(l), l.email, l.phone].some((v) =>
      v?.toLowerCase().includes(q.toLowerCase()),
    ),
  );
  const visibleStages = stages.filter(
    (s) =>
      ["new", "contacted", "qualified"].includes(s) ||
      filtered.some((l) => l.status === s),
  );
  // Unknown future stages must remain visible rather than silently disappearing from the board.
  for (const lead of filtered)
    if (!visibleStages.includes(lead.status)) visibleStages.push(lead.status);
  async function change(ids: string[], action: string, target?: string) {
    if (lock.current || !ids.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const outcomes = await Promise.allSettled(
      ids.map(async (id) => {
        const assign = action === "assign";
        const r = await fetch(
          `/api/admin/brokerage/crm/leads/${id}${assign ? "" : "/actions"}`,
          {
            method: assign ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              assign
                ? { ownerClerkUserId: target }
                : {
                    action: "transition_stage",
                    toStage: target,
                    reason: reason.trim() || undefined,
                  },
            ),
          },
        );
        const j = await r.json();
        if (!r.ok || !j.ok || (assign && j.lead?.id !== id))
          throw new Error(j.error || "Update not confirmed");
      }),
    );
    const succeeded = outcomes.filter((o) => o.status === "fulfilled").length;
    const failed = outcomes.length - succeeded;
    const firstFailure = outcomes.find((o) => o.status === "rejected");
    if (firstFailure?.status === "rejected")
      setError(
        firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : "An update could not be confirmed.",
      );
    setMessage(
      `${succeeded} of ${ids.length} updates confirmed.${failed ? ` ${failed} failed or could not be confirmed. Refresh and review before retrying.` : ""}`,
    );
    setSelected([]);
    setReason("");
    lock.current = false;
    setBusy(false);
    refresh();
  }
  const open = (l: Lead) =>
    workspace?.openRecord({ id: l.id, name: leadTitle(l), kind: "lead" });
  return (
    <section className="crm-leads-workbench">
      <header className="crm-page-intro">
        <div>
          <p className="crm-eyebrow">FROM FIRST HELLO TO FUNDED</p>
          <h1>Lead pipeline</h1>
          <p>
            Every opportunity, its next step, and the person moving it forward.
          </p>
        </div>
        <button
          className="crm-primary-action"
          onClick={() => {
            if (!newLead || confirmCrmDiscard()) setNewLead((v) => !v);
          }}
        >
          {newLead ? "Close intake" : "+ New opportunity"}
        </button>
      </header>
      {newLead && (
        <LeadIntake
          onSaved={(id, name) => {
            setNewLead(false);
            refresh();
            workspace?.openRecord({ id, name, kind: "lead" });
          }}
        />
      )}
      <div className="crm-filter-bar">
        <label>
          Focus
          <select value={queue} onChange={(e) => setQueue(e.target.value)}>
            {queues.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="crm-filter-search">
          Find an opportunity
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Business, person, email or phone"
          />
        </label>
        <div
          className="crm-view-toggle"
          role="group"
          aria-label="Pipeline view"
        >
          <button
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            Board
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            List
          </button>
        </div>
        <button onClick={refresh} disabled={loading || busy}>
          Refresh
        </button>
      </div>
      <p className="crm-source-note">
        {loading
          ? "Loading opportunities…"
          : `${filtered.length} matching opportunities in this loaded queue.`}{" "}
        Board columns show populated stages plus New, Contacted and Qualified.
        Use each card’s stage menu to move it; qualification rules still apply.
      </p>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="crm-save-message">
          {message}
        </p>
      )}
      {selected.length > 0 && (
        <fieldset className="crm-bulk-bar" disabled={busy}>
          <legend>{selected.length} selected</legend>
          <label>
            Action
            <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
              <option value="assign">Assign owner</option>
              <option value="nurture">Move to nurture</option>
              <option value="disqualified">Disqualify</option>
            </select>
          </label>
          {bulk === "assign" ? (
            <label>
              Teammate
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Choose a teammate</option>
                {team.map((m) => (
                  <option key={m.clerkUserId} value={m.clerkUserId}>
                    {ownerName(m.clerkUserId)}
                  </option>
                ))}
              </select>
              {!team.length && (
                <small>
                  Team list unavailable. Open a full record to review ownership.
                </small>
              )}
            </label>
          ) : bulk === "disqualified" ? (
            <label>
              Required reason
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          ) : (
            <p>Selected leads will move to nurture.</p>
          )}
          <button
            disabled={
              bulk === "assign"
                ? !owner
                : bulk === "disqualified"
                  ? !reason.trim()
                  : false
            }
            onClick={() =>
              void change(
                selected,
                bulk === "assign" ? "assign" : "stage",
                bulk === "assign" ? owner : bulk,
              )
            }
          >
            {busy ? "Applying…" : `Apply to ${selected.length} leads`}
          </button>
          <button onClick={() => setSelected([])}>Clear selection</button>
        </fieldset>
      )}
      {!loading && !error && !filtered.length && (
        <div className="crm-empty-card">
          <span aria-hidden="true">↗</span>
          <h2>
            {q
              ? "No matching opportunities"
              : "Your next opportunity starts here"}
          </h2>
          <p>
            {q
              ? "Try another name or clear your search."
              : "Add a lead with an email or phone number. You can fill in the rest as the conversation develops."}
          </p>
          <button onClick={() => (q ? setQ("") : setNewLead(true))}>
            {q ? "Clear search" : "Add an opportunity"}
          </button>
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div
          className={
            view === "board" ? "crm-pipeline-board" : "crm-pipeline-list"
          }
          aria-busy={busy}
        >
          {(view === "board" ? visibleStages : ["all"]).map((stage) => (
            <section key={stage} className="crm-pipeline-column">
              {view === "board" && (
                <h2>
                  <span className="crm-stage-dot" />
                  {humanLabel(stage)}
                  <span>
                    {filtered.filter((l) => l.status === stage).length}
                  </span>
                </h2>
              )}
              {filtered
                .filter((l) => stage === "all" || l.status === stage)
                .map((l) => (
                  <article className="crm-lead-card" key={l.id}>
                    <div className="crm-lead-card-top">
                      <span className="crm-badge">
                        {humanLabel(l.priority || "normal")} priority
                      </span>
                      <input
                        type="checkbox"
                        disabled={busy}
                        aria-label={`Select ${leadTitle(l)}`}
                        checked={selected.includes(l.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, l.id]
                              : s.filter((id) => id !== l.id),
                          )
                        }
                      />
                    </div>
                    <button
                      className="crm-record-title"
                      onClick={() => open(l)}
                    >
                      {leadTitle(l)}
                    </button>
                    <p>
                      {l.email || l.phone || "Contact details not recorded"}
                    </p>
                    <strong className="crm-lead-amount">
                      {l.loan_amount_requested != null
                        ? new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          }).format(l.loan_amount_requested)
                        : "Amount to discuss"}
                    </strong>
                    <div className="crm-next-step">
                      <small>NEXT STEP</small>
                      <p>
                        {l.next_action ||
                          "Choose a next step in the full record"}
                      </p>
                      {l.next_action_due_at && (
                        <time>
                          {new Date(l.next_action_due_at).toLocaleDateString()}
                        </time>
                      )}
                    </div>
                    <footer>
                      <span>{ownerName(l.owner_clerk_user_id)}</span>
                      <Link href={`/admin/brokerage/crm/leads/${l.id}`}>
                        Full record ↗
                      </Link>
                    </footer>
                    <label className="crm-stage-select">
                      Stage
                      <select
                        disabled={busy}
                        value={l.status}
                        onChange={(e) =>
                          void change([l.id], "stage", e.target.value)
                        }
                      >
                        {Array.from(
                          new Set([
                            l.status,
                            ...(ALLOWED_TRANSITIONS[l.status as LeadStage] ||
                              []),
                          ]),
                        )
                          .filter(
                            (s) =>
                              ![
                                "lost",
                                "disqualified",
                                "converted",
                                "withdrawn",
                              ].includes(s) || s === l.status,
                          )
                          .map((s) => (
                            <option key={s} value={s}>
                              {humanLabel(s)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function LeadIntake({
  onSaved,
}: {
  onSaved: (id: string, name: string) => void;
}) {
  const [form, setForm] = useState({
    businessName: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    amount: "",
    loanPurpose: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const dirty = busy || Object.values(form).some(Boolean);
  useCrmDraftGuard(dirty);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (!form.email.trim() && !form.phone.trim()) {
      setError(
        "Add an email or phone number so this opportunity has a contact.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/brokerage/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email: form.email.trim(),
          phone: form.phone.trim(),
          loanAmountRequested: form.amount ? Number(form.amount) : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok || !j.leadId) throw new Error();
      onSaved(
        j.leadId,
        form.businessName ||
          `${form.firstName} ${form.lastName}`.trim() ||
          form.email ||
          form.phone,
      );
    } catch {
      setError(
        "Save could not be confirmed. Your details are preserved. Check the pipeline before retrying.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="crm-intake crm-surface"
      data-crm-dirty={dirty}
      onSubmit={save}
    >
      <h2>Start with the essentials</h2>
      <p>
        An email or phone is all you need. Matching contacts may update an
        existing lead instead of creating a duplicate.
      </p>
      <fieldset disabled={busy}>
        <div className="crm-form-grid">
          {(
            [
              ["businessName", "Business name", "text"],
              ["firstName", "First name", "text"],
              ["lastName", "Last name", "text"],
              ["email", "Email", "email"],
              ["phone", "Phone", "tel"],
              ["amount", "Requested amount (optional)", "number"],
            ] as const
          ).map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                value={form[key]}
                type={type}
                min={type === "number" ? 0 : undefined}
                step={type === "number" ? "0.01" : undefined}
                maxLength={200}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <details>
          <summary>Add purpose and conversation notes</summary>
          <label>
            Loan purpose
            <input
              value={form.loanPurpose}
              maxLength={1000}
              onChange={(e) =>
                setForm((f) => ({ ...f, loanPurpose: e.target.value }))
              }
            />
          </label>
          <label>
            Notes
            <textarea
              value={form.notes}
              maxLength={10000}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </label>
        </details>
        <button className="crm-primary-action" type="submit">
          {busy ? "Saving…" : "Save and open opportunity"}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
