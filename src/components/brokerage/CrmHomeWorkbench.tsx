"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CRM_ROOT } from "@/lib/crm/experience";
import { humanLabel } from "@/lib/crm/workspaceModel";
import type { RevenueOperatingSystem } from "@/lib/crm/revenueOperatingSystem";
import { useCrmWorkspace } from "./CrmWorkspaceFrame";
import type { CrmToday } from "./CrmToday";
import { CrmTaskInventory } from "./CrmTaskInventory";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  notation: value >= 1_000_000 ? "compact" : "standard",
}).format(value);

const FUNNEL_LABELS: Record<string, string> = {
  qualifying: "Qualifying", packaging: "Packaging", out_to_banks: "Out to banks",
  term_sheet: "Term sheet", closing: "Closing", funded: "Funded",
};

export function CrmHomeWorkbench({ loading: relationshipLoading, error: relationshipError, activity, organizations = [] }: React.ComponentProps<typeof CrmToday>) {
  const workspace = useCrmWorkspace();
  const [command, setCommand] = useState<RevenueOperatingSystem | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "critical" | "stalled" | "unassigned">("all");
  const [selectedCompany, setSelectedCompany] = useState("");
  const refresh = () => workspace?.refresh();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/brokerage/crm/command-center", { signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "The brokerage command center could not be loaded.");
        if (!controller.signal.aborted) { setCommand(json.command); setError(""); setState("ready"); }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "The brokerage command center could not be loaded."); setState("error"); }
      });
    return () => controller.abort();
  }, [workspace?.revision]);

  const work = useMemo(() => {
    if (!command) return [];
    if (filter === "critical") return command.work.filter((item) => item.severity === "critical");
    if (filter === "stalled") return command.work.filter((item) => item.reasons.includes("Stalled in stage"));
    if (filter === "unassigned") return command.work.filter((item) => item.reasons.includes("Needs an owner"));
    return command.work;
  }, [command, filter]);

  if (relationshipError && !command) return <div className="crm-empty" role="alert"><h2>Your operating picture is unavailable</h2><p>Relationship activity could not be confirmed. No totals are being presented as zero.</p><button className="crm-button" onClick={refresh}>Try again</button></div>;
  if ((state === "loading" || relationshipLoading) && !command) return <div className="crm-loading" role="status"><span className="crm-loading-orbit" />Building your brokerage command center…</div>;
  if (state === "error" || !command) return <div className="crm-empty" role="alert"><h2>Your operating picture is unavailable</h2><p>{error || "Buddy could not confirm the current brokerage data."} No totals are being presented as zero.</p><button className="crm-button" onClick={refresh}>Try again</button></div>;

  const setupPercent = Math.round((command.setup.complete / command.setup.total) * 100);
  const maxFunnel = Math.max(...command.funnel.map((stage) => stage.count), 1);
  return (
    <div className="crm-home crm-command-home">
      <section className="crm-command-hero">
        <div><p className="crm-eyebrow">TODAY AT BUDDY SBA</p><h1>Turn attention into momentum.</h1><p>One operating picture for every lead, relationship, deal, lender, and next action.</p></div>
        <div className="crm-command-actions"><Link className="crm-secondary-button" href="/admin/brokerage/pipeline?attention=1">Rescue the pipeline</Link><Link className="crm-button" href="/admin/brokerage/pipeline/new">+ Load a deal</Link></div>
      </section>

      <section className="crm-command-scoreboard" aria-label="Brokerage operating totals">
        <Link href="/admin/brokerage/pipeline"><span>ACTIVE DEALS</span><strong>{command.metrics.activeDeals}</strong><small>{money(command.metrics.pipelineValue)} in pipeline</small></Link>
        <button onClick={() => setFilter("critical")}><span>NEEDS ATTENTION</span><strong>{command.metrics.needsAttention}</strong><small>Open the rescue queue</small></button>
        <Link href={`${CRM_ROOT}/leads`}><span>ACTIVE LEADS</span><strong>{command.metrics.activeLeads}</strong><small>{command.metrics.convertedLeads} recently converted</small></Link>
        <Link href={`${CRM_ROOT}/buyers`}><span>ACTIVE PLACEMENTS</span><strong>{command.metrics.activeSubmissions}</strong><small>Files moving with lenders</small></Link>
      </section>

      {command.metrics.activeDeals === 0 && command.metrics.activeLeads === 0 ? (
        <section className="crm-launch-path" aria-labelledby="crm-launch-title">
          <header><div><p className="crm-eyebrow">START HERE</p><h2 id="crm-launch-title">Your first real opportunity, without the learning curve.</h2></div><p>Buddy keeps every conversation, document, lender, and next action attached to the same opportunity.</p></header>
          <div>
            <Link href={`${CRM_ROOT}/leads`}><span>1</span><strong>Capture the opportunity</strong><small>Start with a name plus an email or phone number. Add the rest as you learn it.</small><b>Open lead pipeline →</b></Link>
            <Link href="/admin/brokerage/pipeline/new"><span>2</span><strong>Open the brokerage file</strong><small>Already have a qualified borrower? Create the deal directly and assign its first next action.</small><b>Load a deal →</b></Link>
            <Link href={`${CRM_ROOT}/buyers`}><span>3</span><strong>Build lender readiness</strong><small>Record bank appetite once so every future deal starts with a smarter shortlist.</small><b>Open lender network →</b></Link>
          </div>
        </section>
      ) : null}

      <div className="crm-command-layout">
        <main className="crm-command-main">
          <section className="crm-command-focus">
            <header><div><p className="crm-eyebrow">THE WORK THAT MOVES REVENUE</p><h2>What needs to happen next</h2></div><button className="crm-text-link" onClick={refresh}>↻ Refresh</button></header>
            <div className="crm-command-filter" role="group" aria-label="Revenue work filters">
              {([["all", "All priorities"], ["critical", "Critical"], ["unassigned", "Needs an owner"], ["stalled", "Stalled"]] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
            </div>
            <div className="crm-command-worklist">
              {work.slice(0, 12).map((item, index) => (
                <article key={item.id} className={`crm-command-work crm-command-${item.severity}`}>
                  <span className="crm-command-rank">{String(index + 1).padStart(2, "0")}</span>
                  <div><div className="crm-command-work-meta"><span>{humanLabel(item.stageGroup)}</span>{item.daysInStage !== null ? <span>{item.daysInStage} days in stage</span> : null}{item.amount ? <span>{money(item.amount)}</span> : null}</div><h3>{item.title}</h3><p>{item.reasons.join(" · ")}</p>{item.nextTask ? <small>Next: {item.nextTask.title}</small> : <small>Buddy needs a named next action before this deal can disappear from the queue.</small>}</div>
                  <Link className="crm-row-action" href={`/admin/brokerage/pipeline/${item.id}`}>Move it forward →</Link>
                </article>
              ))}
              {!work.length ? <div className="crm-empty"><span className="crm-empty-symbol">✓</span><h3>This queue is clear</h3><p>Choose another filter or keep building relationships.</p></div> : null}
            </div>
            {work.length > 12 ? <footer><Link className="crm-text-link" href="/admin/brokerage/pipeline?attention=1">See all {work.length} deals needing attention →</Link></footer> : null}
          </section>

          <section className="crm-command-funnel">
            <header><div><p className="crm-eyebrow">FROM FIRST CALL TO FUNDED</p><h2>Your revenue journey</h2></div><Link className="crm-text-link" href="/admin/brokerage/pipeline">Open full pipeline →</Link></header>
            <div className="crm-funnel-stages">{command.funnel.map((stage) => <div key={stage.id}><span>{FUNNEL_LABELS[stage.id] || humanLabel(stage.id)}</span><strong>{stage.count}</strong><small>{money(stage.value)}</small><i><b style={{ width: `${Math.max(4, (stage.count / maxFunnel) * 100)}%` }} /></i></div>)}</div>
          </section>
          <div id="crm-tasks"><CrmTaskInventory /></div>
        </main>

        <aside className="crm-command-aside">
          <section className="crm-setup-card">
            <header><div><p className="crm-eyebrow">BROKERAGE SETUP</p><h2>{command.setup.complete} of {command.setup.total} ready</h2></div><span>{setupPercent}%</span></header>
            <div className="crm-setup-progress"><i style={{ width: `${setupPercent}%` }} /></div><p>Finish these once. Buddy will then tell the team what matters every day.</p>
            <ol>{command.setup.items.map((item) => <li key={item.id} className={item.complete ? "crm-setup-complete" : ""}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div>{!item.complete ? <Link href={item.href}>Fix →</Link> : null}</li>)}</ol>
          </section>

          <section className="crm-next-conversation"><p className="crm-eyebrow">RELATIONSHIP MOMENTUM</p><h2>Who should you call?</h2><p>Open a company to record context, schedule a follow-up, or review relationship intelligence.</p><label htmlFor="crm-command-company">Choose a company</label><select id="crm-command-company" value={selectedCompany} onChange={(event) => setSelectedCompany(event.target.value)}><option value="">Choose a company…</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select><button className="crm-button" disabled={!selectedCompany} onClick={() => { const organization = organizations.find((row) => row.id === selectedCompany); if (organization) workspace?.openRecord({ ...organization, kind: "organization" }); }}>Open relationship →</button></section>

          <section className="crm-command-health"><p className="crm-eyebrow">DATA HEALTH</p><h2>Trust the operating picture</h2><dl><div><dt>Deals without next action</dt><dd>{command.health.dealsWithoutNextAction}</dd></div><div><dt>Unowned companies</dt><dd>{command.health.unassignedOrganizations}</dd></div><div><dt>Unlinked people</dt><dd>{command.health.unlinkedPeople}</dd></div><div><dt>Incomplete lenders</dt><dd>{command.health.incompleteLenders}</dd></div><div><dt>Message readiness</dt><dd>{command.health.templatePercent}%</dd></div></dl></section>

          <section className="crm-command-activity"><header><h2>Latest signals</h2><span>Team context</span></header>{relationshipError ? <p>Relationship activity is unavailable.</p> : activity.slice(0, 4).map((item) => <article key={item.id}><span className="crm-badge">{humanLabel(item.kind)}</span><strong>{item.title || humanLabel(item.kind)}</strong><small>{item.organizationName || "CRM activity"}</small></article>)}</section>
        </aside>
      </div>
    </div>
  );
}
