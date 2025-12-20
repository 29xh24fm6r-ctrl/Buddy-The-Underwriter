"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

export const dynamic = "force-dynamic";

export default function BorrowerDealPage({ params }: { params: { dealId: string } }) {
  const dealId = params.dealId;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Borrower Portal</h1>
          <p className="text-sm text-muted-foreground">Apply pack → invite borrower → see inbox uploads</p>
        </div>
        <Link className="text-sm underline" href={`/deals/${dealId}`}>Back to Deal</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="font-medium">A) Apply Pack to Deal</div>
          <p className="text-sm text-muted-foreground">
            Creates borrower_document_requests from the best matching pack (idempotent).
          </p>
          <ApplyPackButton dealId={dealId} />
        </div>

        <div className="rounded-2xl border p-4 space-y-3">
          <div className="font-medium">B) Create Borrower Invite</div>
          <p className="text-sm text-muted-foreground">
            Generates a token link (no borrower login needed).
          </p>
          <InviteBox dealId={dealId} />
        </div>
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="font-medium">C) Upload Inbox</div>
        <p className="text-sm text-muted-foreground">
          All uploads land here. Auto-match attaches when confidence is high.
        </p>
        <InboxTable dealId={dealId} />
      </div>
    </div>
  );
}

function ApplyPackButton({ dealId }: { dealId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function apply() {
    setBusy(true);
    setMsg("");
    try {
      const out = await fetch(`/api/deals/${dealId}/packs/apply`, { method: "POST" }).then(r => r.json());
      if (out.ok) {
        setMsg(`Applied. Created ${out.result.createdRequests} requests`);
      } else {
        setMsg(`Error: ${out.error}`);
      }
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={apply}
        disabled={busy}
        className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Applying..." : "Apply Best Pack"}
      </button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

function InviteBox({ dealId }: { dealId: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function create() {
    setBusy(true);
    setMsg("");
    try {
      const out = await fetch(`/api/deals/${dealId}/portal/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email || null, expiresDays: 14 }),
      }).then(r => r.json());

      if (!out.ok) {
        setMsg(`Error: ${out.error}`);
        return;
      }

      await navigator.clipboard.writeText(out.link);
      setMsg(`Invite link copied: ${out.link}`);
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Borrower email (optional)"
        className="w-full rounded-xl border px-3 py-2 text-sm"
      />
      <button
        onClick={create}
        disabled={busy}
        className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Creating..." : "Create Invite + Copy Link"}
      </button>
      <p className="text-xs text-muted-foreground">Link format: /borrower/&lt;token&gt;</p>
      {msg && <p className="text-xs text-green-700">{msg}</p>}
    </div>
  );
}

function InboxTable({ dealId }: { dealId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/uploads/inbox`, { cache: "no-store" })
      .then(r => r.json())
      .then(out => {
        setRows(out.ok ? out.rows : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dealId]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">When</th>
            <th className="py-2 pr-4">File</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Match</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 pr-4">{new Date(r.created_at).toLocaleString()}</td>
              <td className="py-2 pr-4">{r.filename}</td>
              <td className="py-2 pr-4">{r.status}</td>
              <td className="py-2 pr-4">{r.match_confidence ? `${r.match_confidence}%` : "-"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td className="py-4 text-muted-foreground" colSpan={4}>No uploads yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
