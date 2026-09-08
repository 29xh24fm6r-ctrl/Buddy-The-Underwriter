"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CRM_ROOT, prioritizeTasks, taskDueLabel } from "@/lib/crm/experience";
import type { FocusTask } from "@/lib/crm/experience";
import { CrmActivityComposer } from "./CrmActivityComposer";

type Relationship = { id: string; name: string; lastActivityAt: string | null; health: string };
type Activity = { id: string; title: string | null; kind: string; organizationId: string | null; organizationName: string | null };

export function CrmToday({ loading, error, tasks, relationships, activity, onRetry, now, organizations = [] }: {
  loading: boolean; error: string | null; tasks: FocusTask[]; relationships: Relationship[]; activity: Activity[]; onRetry: () => void; now: number;
  organizations?: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState("");
  const selectedOrganization = organizations.find(org => org.id === selected);
  if (loading && !organizations.length) return <div className="crm-experience crm-empty" role="status">Gathering your follow-ups and relationship activity…</div>;
  if (error) return <div className="crm-experience crm-empty" role="alert"><h2>We couldn’t load your day</h2><p>Try again to see current work. This overview could not be refreshed.</p><button className="crm-button" onClick={onRetry}>Try again</button></div>;
  const sortedTasks = prioritizeTasks(tasks);
  return (
    <div className="crm-experience">
      <section className="crm-focus-banner" aria-labelledby="crm-focus-title">
        <div><h2 id="crm-focus-title">Your relationship workbench</h2><p>{tasks.length} open tasks shown · {relationships.length} check-in suggestions</p><details><summary className="crm-small">What’s included?</summary><p className="crm-small">Overview of the latest 500 CRM activities and up to 8 check-in suggestions, not a complete task inventory. Check Pipeline for lead follow-ups and Lender network for placements.</p></details><button className="crm-text-link" onClick={onRetry}>Refresh overview</button></div>
        <Link className="crm-button" href={`${CRM_ROOT}/leads`} prefetch={false}>Review lead pipeline →</Link>
      </section>
      <details className="crm-quick-capture"><summary>+ Record activity or set a follow-up</summary><label>Choose a relationship<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a company…</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>{selectedOrganization && <CrmActivityComposer key={selected} organizationId={selected} organizationName={selectedOrganization.name} onSaved={onRetry} />}{!organizations.length && <p>No companies available. Open Relationships to add one.</p>}</details>
      <div className="crm-today-grid">
        <section className="crm-panel" aria-labelledby="crm-tasks-title"><div className="crm-panel-heading"><h2 id="crm-tasks-title">Follow-ups & tasks</h2><span className="crm-count">{tasks.length}</span></div><p className="crm-panel-hint">Due dates first. Open a relationship to review the task in context.</p>
          {sortedTasks.length ? <ul className="crm-work-list">{sortedTasks.map((task) => <li key={task.id}><div><span className="crm-badge">{taskDueLabel(task.due_at, now)}</span><h3>{task.title || "Untitled task"}</h3><p>{task.organizationName || "No linked organization"}</p></div>{task.organizationId ? <Link className="crm-text-link" href={`${CRM_ROOT}/${task.organizationId}`} prefetch={false}>Open relationship →</Link> : <span className="crm-small">No organization link available</span>}</li>)}</ul> : <div className="crm-empty"><span aria-hidden="true">✓</span><h3>No open tasks in this overview</h3><p>Keep momentum: review leads or plan your next relationship check-in.</p></div>}
        </section>
        <section className="crm-panel" aria-labelledby="crm-relationships-title"><div className="crm-panel-heading"><h2 id="crm-relationships-title">Keep in touch</h2><span className="crm-count">{relationships.length}</span></div><p className="crm-panel-hint">Reconnect with relationships flagged by the existing CRM health signal.</p>
          {relationships.length ? <ul className="crm-work-list">{relationships.map((org) => <li key={org.id}><div><span className="crm-badge">{org.health === "cold" ? "Reconnect" : "Check in"}</span><h3>{org.name}</h3><p>{org.lastActivityAt && Number.isFinite(Date.parse(org.lastActivityAt)) ? `Last activity ${new Date(org.lastActivityAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} (UTC)` : "No activity recorded"}</p></div><Link className="crm-text-link" href={`${CRM_ROOT}/${org.id}`} prefetch={false}>Plan a check-in →</Link></li>)}</ul> : <div className="crm-empty"><h3>No relationships flagged</h3><p>Explore your directory to build your next connection.</p><Link className="crm-text-link" href={`${CRM_ROOT}?view=relationships`} prefetch={false}>Browse relationships →</Link></div>}
        </section>
      </div>
      <section className="crm-panel crm-recent" aria-labelledby="crm-recent-title"><div className="crm-panel-heading"><h2 id="crm-recent-title">Recent activity</h2><span className="crm-small">Context, not another to-do list</span></div>{activity.length ? <ul className="crm-work-list">{activity.slice(0, 6).map((item) => <li key={item.id}><div><h3>{item.title || item.kind.replaceAll("_", " ")}</h3><p>{item.organizationName || "CRM activity"}</p></div>{item.organizationId ? <Link className="crm-text-link" href={`${CRM_ROOT}/${item.organizationId}`} prefetch={false}>View →</Link> : null}</li>)}</ul> : <p className="crm-panel-hint">Activity will appear here as your team works with relationships.</p>}</section>
    </div>
  );
}
