import React from "react";
import Link from "next/link";

const journeys = [
  ["01", "Build relationships", "Capture leads, record conversations, and plan your next follow-up.", "/admin/brokerage/crm", "Open CRM"],
  ["02", "Move a deal forward", "Review brokerage stages, owners, and the next task. Open a deal for its documents and underwriting.", "/admin/brokerage/pipeline", "Open brokerage deals"],
  ["03", "Find the right lender", "Manage lender relationships, placements, responses, and next steps.", "/admin/brokerage/crm/buyers", "Open lender placements"],
  ["04", "Run the business", "Prepare referral-fee invoices and track their payment status.", "/admin/brokerage/billing", "Open billing"],
] as const;

export function BrokerageStart() {
  return (
    <section className="sba-start" aria-labelledby="sba-start-title">
      <div className="sba-start-heading">
        <div>
          <p className="sba-eyebrow">BUDDY SBA · TEAM WORKSPACE</p>
          <h1 id="sba-start-title">Your brokerage. One place to work.</h1>
          <p>Start with the relationship. Keep the deal moving. Bring your team with you.</p>
        </div>
        <Link className="sba-primary" href="/admin/brokerage/pipeline/new">+ Add a brokerage deal</Link>
      </div>
      <div className="sba-journeys">
        {journeys.map(([step, title, description, href, action]) => (
          <Link key={href} href={href} className="sba-journey" prefetch={false}>
            <span className="sba-step" aria-hidden="true">{step}</span>
            <h2>{title}</h2><p>{description}</p><strong>{action} →</strong>
          </Link>
        ))}
      </div>
      <div className="sba-team-shortcuts">
        <span>Working together</span>
        <Link href="/admin/brokerage/team">Manage team & access →</Link>
        <Link href="/admin/brokerage/crm#crm-tasks">Relationship tasks →</Link>
        <Link href="/admin/brokerage-owner">Owner reporting →</Link>
      </div>
      <p className="sba-context-note">Documents and underwriting stay attached to each deal. Start in Brokerage deals to keep the right file in context.</p>
    </section>
  );
}
