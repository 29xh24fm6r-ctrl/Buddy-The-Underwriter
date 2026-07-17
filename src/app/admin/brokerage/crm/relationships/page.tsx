"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { CrmTabs } from "@/components/brokerage/CrmTabs";

type Relationship = {
  id: string;
  dealId: string;
  dealLabel: string;
  role: string;
  personId: string | null;
  personName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  notes: string | null;
  createdAt: string;
};

export default function CrmRelationshipsPage() {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/brokerage/crm/relationships")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? "load failed");
        setRelationships(json.relationships ?? []);
      })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />

      <div style={{ fontSize: 12.5, color: c.textSecondary, marginBottom: 16 }}>
        Every external party (referral source, CPA, attorney, title company, etc.) attached to a deal.
        Borrowers, owners, and guarantors live on the deal's own ownership record; internal staff
        (broker, underwriter, closer) live on the deal's participant list — neither is duplicated here.
      </div>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</div>
        ) : relationships.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>
            No external parties attached to any deal yet — add one from a deal's page or an organization's detail page.
          </div>
        ) : (
          relationships.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${c.divider}` }}>
              <div>
                <span style={{ fontSize: 12.5, color: c.paper }}>
                  {r.organizationId ? (
                    <Link href={`/admin/brokerage/crm/${r.organizationId}`} style={{ color: c.paper, textDecoration: "none" }}>{r.organizationName ?? r.organizationId}</Link>
                  ) : r.personId ? (
                    <Link href={`/admin/brokerage/crm/people/${r.personId}`} style={{ color: c.paper, textDecoration: "none" }}>{r.personName ?? r.personId}</Link>
                  ) : (
                    "—"
                  )}
                </span>
                <span style={{ fontSize: 10.5, color: c.textMuted, marginLeft: 8 }}>{r.role.replace("_", " ")}</span>
              </div>
              <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11, color: c.brassBright }}>{r.dealLabel}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
