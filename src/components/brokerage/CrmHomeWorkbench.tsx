"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CRM_ROOT, taskDueLabel } from "@/lib/crm/experience";
import {
  buildWorkQueue,
  CLOSED_LEADS,
  humanLabel,
  type LeadSnapshot,
} from "@/lib/crm/workspaceModel";
import { useCrmWorkspace } from "./CrmWorkspaceFrame";
import { CrmTaskControl } from "./CrmTaskControl";
import type { CrmToday } from "./CrmToday";
import { CrmTaskInventory } from "./CrmTaskInventory";
import { LEAD_STAGES } from "@/lib/leads/stages";

export function CrmHomeWorkbench({
  loading,
  error,
  tasks,
  relationships,
  activity,
  onRetry,
  now,
  organizations = [],
}: React.ComponentProps<typeof CrmToday>) {
  const workspace = useCrmWorkspace();
  const [leads, setLeads] = useState<LeadSnapshot[]>([]);
  const [leadState, setLeadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/brokerage/crm/leads?queue=all", {
      signal: controller.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        if (!controller.signal.aborted) {
          setLeads(j.leads || []);
          setLeadState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLeads([]);
          setLeadState("error");
        }
      });
    return () => controller.abort();
  }, [workspace?.revision]);
  const queue = useMemo(
    () => buildWorkQueue(tasks, leads, relationships),
    [tasks, leads, relationships],
  );
  const visible = queue.filter(
    (item) =>
      filter === "all" ||
      (filter === "overdue"
        ? item.due && Date.parse(item.due) < now
        : item.kind === filter),
  );
  const active = leads.filter((l) => !CLOSED_LEADS.has(l.status));
  const stages = LEAD_STAGES.filter(
    (stage) =>
      !CLOSED_LEADS.has(stage) &&
      (active.some((l) => l.status === stage) ||
        ["new", "contacted", "qualified"].includes(stage)),
  );
  if (loading && !organizations.length)
    return (
      <div className="crm-loading" role="status">
        <span className="crm-loading-orbit" />
        Getting your workspace ready…
      </div>
    );
  if (error)
    return (
      <div className="crm-empty" role="alert">
        <h2>Your workspace needs a refresh</h2>
        <p>
          We couldn’t load current relationship activity. Nothing here is a
          confirmed empty queue.
        </p>
        <button className="crm-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  return (
    <div className="crm-home">
      <section className="crm-home-intro">
        <div>
          <p className="crm-eyebrow">RELATIONSHIPS INTO POSSIBILITIES</p>
          <h2>Make your next move.</h2>
          <p>
            Your commitments, opportunities, and conversations. One place to
            move them forward.
          </p>
        </div>
        <Link className="crm-button" href={`${CRM_ROOT}/leads?new=1`}>
          + New opportunity
        </Link>
      </section>
      <div className="crm-home-stats">
        {[
          ["OPEN COMMITMENTS", tasks.length, "In the activity overview"],
          [
            "ACTIVE LEADS",
            leadState === "ready" ? active.length : "—",
            leadState === "error"
              ? "Unable to load leads"
              : "In the loaded lead pipeline",
          ],
          ["RELATIONSHIPS", organizations.length, "Companies in your network"],
          [
            "CHECK-IN SUGGESTIONS",
            relationships.length,
            "Reconnect with a purpose",
          ],
        ].map(([label, value, caption]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{caption}</small>
          </div>
        ))}
      </div>
      <div className="crm-home-columns">
        <section className="crm-focus-queue">
          <header>
            <div>
              <p className="crm-eyebrow">FOCUS</p>
              <h2>What needs your attention</h2>
            </div>
            <button
              className="crm-text-link"
              onClick={() => {
                onRetry();
                workspace?.refresh();
              }}
            >
              ↻ Refresh
            </button>
          </header>
          <div
            className="crm-filter-bar"
            role="group"
            aria-label="Work queue filters"
          >
            {[
              ["all", "All work"],
              ["overdue", "Overdue"],
              ["task", "Tasks"],
              ["lead", "Leads"],
              ["relationship", "Check-ins"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {leadState !== "ready" && (
            <p className="crm-source-warning" role="status">
              {leadState === "loading"
                ? "Loading lead follow-ups…"
                : "Lead follow-ups unavailable. Refresh to retry; other work remains visible."}
            </p>
          )}
          <div className="crm-queue-items">
            {visible.slice(0, 30).map((item) => (
              <article key={item.key} className="crm-queue-row">
                <span
                  className={`crm-work-icon crm-work-${item.kind}`}
                  aria-hidden="true"
                >
                  {item.kind === "task"
                    ? "✓"
                    : item.kind === "lead"
                      ? "↗"
                      : "◎"}
                </span>
                <div className="crm-work-copy">
                  <small>
                    {humanLabel(item.kind)} · {item.context}
                  </small>
                  <h3>{item.title}</h3>
                  <p>{item.why}</p>
                  {item.due && (
                    <span
                      className={`crm-due ${Date.parse(item.due) < now ? "crm-overdue" : ""}`}
                    >
                      {taskDueLabel(item.due, now)}
                    </span>
                  )}
                  {item.kind === "task" && (
                    <CrmTaskControl
                      id={item.key.slice(5)}
                      completed={false}
                      dueAt={item.due}
                      onSaved={onRetry}
                    />
                  )}
                </div>
                {item.recordId ? (
                  <button
                    className="crm-row-action"
                    onClick={() =>
                      workspace?.openRecord({
                        id: item.recordId!,
                        name: item.recordName,
                        kind: item.recordKind,
                      })
                    }
                  >
                    Open ↗
                  </button>
                ) : (
                  <span className="crm-small">
                    No organization link available
                  </span>
                )}
              </article>
            ))}
          </div>
          {!visible.length && (
            <div className="crm-empty">
              <span className="crm-empty-symbol">✧</span>
              <h3>
                {filter === "all"
                  ? "Space for your next opportunity"
                  : "No matching work in this view"}
              </h3>
              <p>
                {filter === "all"
                  ? "No open tasks in this overview. Add a relationship or review the pipeline to plan your next move."
                  : "Choose All work to return to your current queue."}
              </p>
              <Link
                className="crm-text-link"
                href={`${CRM_ROOT}?view=relationships`}
              >
                Explore relationships →
              </Link>
            </div>
          )}
          <footer>
            <details>
              <summary>About this work queue</summary>
              <p>
                Tasks come from the latest 500 CRM activities, with up to 8
                check-in suggestions. Leads come from the loaded lead pipeline.
                This is not a complete task inventory. Lender placement
                follow-ups remain in Lender network. Showing up to 30 matching
                items, due dates first.
              </p>
            </details>
          </footer>
        </section>
        <aside className="crm-home-aside">
          <section className="crm-network-card">
            <div className="crm-network-art" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>◎</span>
            </div>
            <p className="crm-eyebrow">YOUR NEXT CONVERSATION</p>
            <h2>
              Small touches.
              <br />
              Stronger relationships.
            </h2>
            <p>
              Pick a company to capture context or plan a follow-up. No
              navigation detour.
            </p>
            <label className="crm-sr-only" htmlFor="crm-home-company">
              Choose a relationship
            </label>
            <select
              id="crm-home-company"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a company…</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button
              className="crm-button"
              disabled={!selected}
              onClick={() => {
                const org = organizations.find((o) => o.id === selected);
                if (org)
                  workspace?.openRecord({ ...org, kind: "organization" });
              }}
            >
              Open relationship workspace →
            </button>
          </section>
          <section className="crm-pipeline-pulse">
            <h3>Pipeline at a glance</h3>
            <p>Active opportunities by stage</p>
            {leadState === "ready" ? (
              stages.map((stage) => {
                const count = active.filter((l) => l.status === stage).length;
                return (
                  <div className="crm-stage-meter" key={stage}>
                    <span>{humanLabel(stage)}</span>
                    <strong>{count}</strong>
                    <div>
                      <i
                        style={{
                          width: `${active.length ? (count / active.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p>
                Pipeline counts{" "}
                {leadState === "loading" ? "loading…" : "unavailable"}.
              </p>
            )}
            <Link className="crm-text-link" href={`${CRM_ROOT}/leads`}>
              Open lead pipeline →
            </Link>
          </section>
        </aside>
      </div>
      <div id="crm-tasks">
        <CrmTaskInventory />
      </div>
      <section className="crm-activity-strip">
        <header>
          <h2>Latest relationship activity</h2>
          <span>Context from your team</span>
        </header>
        {activity.length ? (
          <div>
            {activity.slice(0, 4).map((a) => (
              <article key={a.id}>
                <span className="crm-badge">{humanLabel(a.kind)}</span>
                <h3>{a.title || humanLabel(a.kind)}</h3>
                <p>{a.organizationName || "CRM activity"}</p>
                {a.organizationId && (
                  <button
                    className="crm-text-link"
                    onClick={() =>
                      workspace?.openRecord({
                        id: a.organizationId!,
                        name: a.organizationName || "Relationship",
                        kind: "organization",
                      })
                    }
                  >
                    View context →
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p>Your first conversations will appear here.</p>
        )}
      </section>
    </div>
  );
}
