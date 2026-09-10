import "server-only";

import Link from "next/link";
import { loadRevenueOperatingSystem } from "@/lib/crm/loadRevenueOperatingSystem";
import { CrmWorkspaceFrame } from "@/components/brokerage/CrmWorkspaceFrame";

export const dynamic = "force-dynamic";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  notation: value >= 1_000_000 ? "compact" : "standard",
}).format(value);

export default async function BrokerageOwnerPage() {
  const command = await loadRevenueOperatingSystem();
  const setupPercent = Math.round((command.setup.complete / command.setup.total) * 100);
  return (
    <CrmWorkspaceFrame>
    <div className="crm-home crm-command-home crm-owner-command">
      <section className="crm-command-hero">
        <div><p className="crm-eyebrow">OWNER COMMAND</p><h1>Know the business. Move the business.</h1><p>Revenue, risk, team execution, and relationship readiness from the same operating ledger your team uses every day.</p></div>
        <div className="crm-command-actions"><Link className="crm-secondary-button" href="/admin/brokerage/crm">Open today&apos;s work</Link><Link className="crm-button" href="/admin/brokerage/pipeline/new">+ New opportunity</Link></div>
      </section>
      <section className="crm-command-scoreboard" aria-label="Owner operating totals">
        <Link href="/admin/brokerage/pipeline"><span>ACTIVE DEALS</span><strong>{command.metrics.activeDeals}</strong><small>{money(command.metrics.pipelineValue)} in active pipeline</small></Link>
        <Link href="/admin/brokerage/pipeline?attention=1"><span>NEEDS ATTENTION</span><strong>{command.metrics.needsAttention}</strong><small>Deals requiring a decision</small></Link>
        <Link href="/admin/brokerage/crm/leads"><span>ACTIVE LEADS</span><strong>{command.metrics.activeLeads}</strong><small>{command.metrics.convertedLeads} converted</small></Link>
        <Link href="/admin/brokerage/crm/buyers"><span>LENDER PLACEMENTS</span><strong>{command.metrics.activeSubmissions}</strong><small>Active lender conversations</small></Link>
      </section>
      <div className="crm-command-layout">
        <main className="crm-command-main">
          <section className="crm-command-funnel">
            <header><div><p className="crm-eyebrow">REVENUE JOURNEY</p><h2>Pipeline by stage</h2></div><Link className="crm-text-link" href="/admin/brokerage/pipeline">Open full pipeline →</Link></header>
            <div className="crm-funnel-stages">{command.funnel.map((stage) => <div key={stage.id}><span>{stage.id.replaceAll("_", " ")}</span><strong>{stage.count}</strong><small>{money(stage.value)}</small></div>)}</div>
          </section>
          <section className="crm-command-focus">
            <header><div><p className="crm-eyebrow">EXECUTION RISK</p><h2>What could slow revenue</h2></div><Link className="crm-text-link" href="/admin/brokerage/pipeline?attention=1">Open rescue queue →</Link></header>
            <div className="crm-command-worklist">
              {command.work.slice(0, 8).map((item, index) => <article key={item.id} className={`crm-command-work crm-command-${item.severity}`}><span className="crm-command-rank">{String(index + 1).padStart(2, "0")}</span><div><div className="crm-command-work-meta"><span>{item.stageGroup.replaceAll("_", " ")}</span>{item.amount ? <span>{money(item.amount)}</span> : null}</div><h3>{item.title}</h3><p>{item.reasons.join(" · ")}</p></div><Link className="crm-row-action" href={`/admin/brokerage/pipeline/${item.id}`}>Resolve →</Link></article>)}
              {!command.work.length ? <div className="crm-empty"><span className="crm-empty-symbol">✓</span><h3>No execution risks</h3><p>Your active book has owners, next actions, and healthy stage velocity.</p></div> : null}
            </div>
          </section>
        </main>
        <aside className="crm-command-aside">
          <section className="crm-setup-card"><header><div><p className="crm-eyebrow">OPERATING READINESS</p><h2>{command.setup.complete} of {command.setup.total} ready</h2></div><span>{setupPercent}%</span></header><div className="crm-setup-progress"><i style={{ width: `${setupPercent}%` }} /></div><ol>{command.setup.items.map((item) => <li key={item.id} className={item.complete ? "crm-setup-complete" : ""}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div>{!item.complete ? <Link href={item.href}>Fix →</Link> : null}</li>)}</ol></section>
          <section className="crm-command-health"><p className="crm-eyebrow">DATA CONFIDENCE</p><h2>Can you trust today&apos;s picture?</h2><dl><div><dt>Deals without next action</dt><dd>{command.health.dealsWithoutNextAction}</dd></div><div><dt>Unowned companies</dt><dd>{command.health.unassignedOrganizations}</dd></div><div><dt>Unlinked people</dt><dd>{command.health.unlinkedPeople}</dd></div><div><dt>Incomplete lenders</dt><dd>{command.health.incompleteLenders}</dd></div><div><dt>Message readiness</dt><dd>{command.health.templatePercent}%</dd></div></dl></section>
        </aside>
      </div>
      <p className="crm-owner-asof">Authoritative operating snapshot · {new Date(command.generatedAt).toLocaleString()}</p>
    </div>
    </CrmWorkspaceFrame>
  );
}
