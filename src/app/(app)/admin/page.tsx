import Link from "next/link";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import {
  GlassShell,
  GlassPageHeader,
  GlassActionCard,
  GlassInfoBox,
} from "@/components/layout";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const bankPick = await tryGetCurrentBankId();
  const bankId = bankPick.ok ? bankPick.bankId : null;

  const bankSuffix = bankId ? `?bankId=${encodeURIComponent(bankId)}` : "";

  return (
    <GlassShell>
      <GlassPageHeader
        title="Admin"
        subtitle="Super-admin tooling for templates, audit, and platform configuration"
        badge={
          <span className="text-xs font-mono text-white/50">
            Bank: {bankId ?? "(none)"}
            {!bankPick.ok ? ` (${bankPick.reason})` : ""}
            {process.env.NEXT_PUBLIC_GIT_SHA ? ` · Build: ${process.env.NEXT_PUBLIC_GIT_SHA.slice(0, 7)}` : ""}
          </span>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <GlassActionCard
          icon="shield_person"
          iconColor="text-blue-400"
          title="Roles"
          description="Assign Clerk roles (super_admin, etc.)."
          href="/admin/roles"
          actionLabel="Manage Roles"
        />

        <GlassActionCard
          icon="lock"
          iconColor="text-emerald-400"
          title="Permissions"
          description="Live capability matrix from current users."
          href="/admin/permissions"
          actionLabel="View Permissions"
        />

        <GlassActionCard
          icon="history"
          iconColor="text-amber-400"
          title="Audit"
          description="Canonical event ledger viewer (audit_ledger)."
          href="/admin/audit"
          actionLabel="View Audit Log"
        />

        <GlassActionCard
          icon="description"
          iconColor="text-purple-400"
          title="Templates"
          description="Upload/list bank PDF templates (AcroForm parsing)."
          href="/admin/templates"
          actionLabel="Manage Templates"
        />

        <GlassActionCard
          icon="text_fields"
          iconColor="text-cyan-400"
          title="Fields"
          description="Template field registry + required flags."
          href="/admin/fields"
          actionLabel="View Fields"
        />

        <GlassActionCard
          icon="merge"
          iconColor="text-pink-400"
          title="Merge Fields"
          description="Canonical field coverage across templates."
          href="/admin/merge-fields"
          actionLabel="View Merge Fields"
        />

        <div className="relative">
          <GlassActionCard
            icon="mail"
            iconColor="text-orange-400"
            title="Email Routing"
            description="Bank-level contact routing & verified sender settings."
            href={`/admin/email-routing${bankSuffix}`}
            actionLabel="Configure Email"
          />
          {!bankId && (
            <div className="absolute bottom-3 left-5 right-5">
              <div className="text-xs text-amber-400">
                Add a bank selection to use this page.
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <GlassActionCard
            icon="folder_shared"
            iconColor="text-sky-400"
            title="Bank Documents"
            description="Bank-level policies, guidelines, and templates."
            href={`/admin/bank${bankSuffix}`}
            actionLabel="Manage Documents"
          />
          {!bankId && (
            <div className="absolute bottom-3 left-5 right-5">
              <div className="text-xs text-amber-400">
                Add a bank selection to use this page.
              </div>
            </div>
          )}
        </div>

        <GlassActionCard
          icon="bug_report"
          iconColor="text-red-400"
          title="Diagnostics"
          description="Pipeline health and job diagnostics."
          href="/admin/diagnostics"
          actionLabel="View Diagnostics"
        />

        <GlassActionCard
          icon="monitoring"
          iconColor="text-teal-400"
          title="Metrics"
          description="Admin telemetry (AI/errors/rate limits)."
          href="/admin/metrics"
          actionLabel="View Metrics"
        />

        <GlassActionCard
          icon="insights"
          iconColor="text-indigo-400"
          title="Intake Metrics"
          description="Auto-attach rates, review routing, override confusion heatmap."
          href="/admin/intake"
          actionLabel="View Intake Metrics"
        />

        <GlassActionCard
          icon="key"
          iconColor="text-yellow-400"
          title="Demo Access"
          description="Invite-only access + usage telemetry."
          href="/admin/demo-access"
          actionLabel="Manage Access"
        />

        <GlassActionCard
          icon="cleaning_services"
          iconColor="text-lime-400"
          title="Demo Hygiene"
          description="Archive, purge, and reset demo deals."
          href="/admin/demo-hygiene"
          actionLabel="Manage Hygiene"
        />
      </div>
    </GlassShell>
  );
}
