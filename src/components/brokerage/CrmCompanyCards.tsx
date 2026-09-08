"use client";
import Link from "next/link";
import React, { useState } from "react";
import { useCrmWorkspace } from "./CrmWorkspaceFrame";
import { humanLabel } from "@/lib/crm/workspaceModel";

type Company = {
  id: string;
  name: string;
  organization_type: string;
  city: string | null;
  state: string | null;
  health: string;
  peopleCount: number;
  lastActivityAt: string | null;
  dealsReferredCount: number;
  dealsReferredValue: number;
  owner_clerk_user_id: string | null;
  tags: string[] | null;
};
export function CrmCompanyCards({
  companies,
  owners,
  loading,
  error,
  onRetry,
}: {
  companies: Company[];
  owners: Record<string, string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [view, setView] = useState("cards");
  const workspace = useCrmWorkspace();
  if (loading)
    return (
      <p role="status" className="crm-empty-card">
        Loading your network…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="crm-empty-card">
        <h2>Your directory needs a refresh</h2>
        <p>We couldn’t confirm the current company list.</p>
        <button onClick={onRetry}>Try again</button>
      </div>
    );
  return (
    <>
      <div className="crm-directory-viewbar">
        <span>
          Open a company to capture activity without losing your place.
        </span>
        <div className="crm-view-toggle" role="group" aria-label="Company view">
          <button
            aria-pressed={view === "cards"}
            onClick={() => setView("cards")}
          >
            Cards
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            List
          </button>
        </div>
      </div>
      <div
        className={`crm-company-grid ${view === "list" ? "crm-company-list" : ""}`}
      >
        {companies.map((o) => (
          <article key={o.id} className="crm-company-card">
            <header>
              <span className="crm-avatar">
                {o.name.slice(0, 2).toUpperCase()}
              </span>
              <span className={`crm-health crm-health-${o.health}`}>
                {humanLabel(o.health)}
              </span>
            </header>
            <button
              className="crm-record-title"
              onClick={() =>
                workspace?.openRecord({
                  id: o.id,
                  name: o.name,
                  kind: "organization",
                })
              }
            >
              {o.name}
            </button>
            <p>
              {humanLabel(o.organization_type)} ·{" "}
              {[o.city, o.state].filter(Boolean).join(", ") ||
                "Location not recorded"}
            </p>
            <div className="crm-company-metrics">
              <div>
                <strong>{o.peopleCount}</strong>
                <small>People</small>
              </div>
              <div>
                <strong>{o.dealsReferredCount}</strong>
                <small>Deals sourced</small>
              </div>
              <div>
                <strong>
                  {o.dealsReferredValue
                    ? new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        notation: "compact",
                      }).format(o.dealsReferredValue)
                    : "—"}
                </strong>
                <small>Value sourced</small>
              </div>
            </div>
            <p className="crm-card-context">
              {o.lastActivityAt
                ? `Last activity ${new Date(o.lastActivityAt).toLocaleDateString()}`
                : "Start the first conversation"}
            </p>
            {Boolean(o.tags?.length) && (
              <div className="crm-card-tags">
                {o.tags!.slice(0, 3).map((tag) => (
                  <span className="crm-badge" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <footer>
              <span>
                {o.owner_clerk_user_id
                  ? owners[o.owner_clerk_user_id] || "Assigned teammate"
                  : "Needs an owner"}
              </span>
              <Link href={`/admin/brokerage/crm/${o.id}`}>Full record ↗</Link>
            </footer>
          </article>
        ))}
      </div>
      {!companies.length && (
        <div className="crm-empty-card">
          <h2>No companies in this view</h2>
          <p>
            Clear your filters or add your first company to start building your
            network.
          </p>
        </div>
      )}
    </>
  );
}
