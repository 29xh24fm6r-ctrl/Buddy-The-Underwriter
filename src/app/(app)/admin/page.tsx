import Link from "next/link";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const bankPick = await tryGetCurrentBankId();
  const bankId = bankPick.ok ? bankPick.bankId : null;

  const bankSuffix = bankId ? `?bankId=${encodeURIComponent(bankId)}` : "";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <div className="text-sm text-muted-foreground">
          Super-admin tooling for templates, audit, and platform configuration.
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Current bank: <span className="font-mono">{bankId ?? "(none)"}</span>
          {!bankPick.ok ? (
            <span className="ml-2">(reason: {bankPick.reason})</span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/roles"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Roles</div>
          <div className="text-sm text-muted-foreground">Assign Clerk roles (super_admin, etc.).</div>
        </Link>

        <Link
          href="/admin/permissions"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Permissions</div>
          <div className="text-sm text-muted-foreground">Live capability matrix from current users.</div>
        </Link>

        <Link
          href="/admin/audit"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Audit</div>
          <div className="text-sm text-muted-foreground">Canonical event ledger viewer (audit_ledger).</div>
        </Link>

        <Link
          href="/admin/templates"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Templates</div>
          <div className="text-sm text-muted-foreground">Upload/list bank PDF templates (AcroForm parsing).</div>
        </Link>

        <Link
          href="/admin/fields"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Fields</div>
          <div className="text-sm text-muted-foreground">Template field registry + required flags.</div>
        </Link>

        <Link
          href="/admin/merge-fields"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Merge Fields</div>
          <div className="text-sm text-muted-foreground">Canonical field coverage across templates.</div>
        </Link>

        <Link
          href={`/admin/email-routing${bankSuffix}`}
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Email Routing</div>
          <div className="text-sm text-muted-foreground">
            Bank-level contact routing & verified sender settings.
          </div>
          {!bankId ? (
            <div className="mt-2 text-xs text-amber-700">Add a bank selection to use this page.</div>
          ) : null}
        </Link>

        <Link
          href="/admin/diagnostics"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Diagnostics</div>
          <div className="text-sm text-muted-foreground">Pipeline health and job diagnostics.</div>
        </Link>

        <Link
          href="/admin/metrics"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Metrics</div>
          <div className="text-sm text-muted-foreground">Admin telemetry (AI/errors/rate limits).</div>
        </Link>

        <Link
          href="/admin/demo-access"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Demo Access</div>
          <div className="text-sm text-muted-foreground">Invite-only access + usage telemetry.</div>
        </Link>

        <Link
          href="/admin/demo-hygiene"
          className="rounded-lg border p-4 hover:bg-muted/50 transition"
        >
          <div className="font-medium">Demo Hygiene</div>
          <div className="text-sm text-muted-foreground">Archive, purge, and reset demo deals.</div>
        </Link>
      </div>
    </div>
  );
}
