// src/app/tenant/select/page.tsx
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { getSandboxAccessDetails } from "@/lib/tenant/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TenantSelectPage() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Select Bank</h1>
        <p className="text-muted-foreground mt-2">Please sign in.</p>
        <Link className="inline-flex mt-4 rounded-xl border px-4 py-2 text-sm font-semibold" href="/sign-in">
          Sign in
        </Link>
      </div>
    );
  }

  const userId = auth.user.id;

  const mem = await sb
    .from("bank_memberships")
    .select("bank_id, role, banks:bank_id(id,name,code,is_sandbox)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const rows = (mem.data ?? []) as any[];
  const sandboxAccess = await getSandboxAccessDetails();
  const visibleRows = rows.filter((r) => (r?.banks?.is_sandbox ? sandboxAccess.allowed : true));

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <h1 className="text-3xl font-bold">Select Bank</h1>
      <p className="text-muted-foreground mt-2">
        You belong to multiple banks. Pick which workspace you want to operate in.
      </p>

      <div className="mt-6 space-y-3">
        {visibleRows.length === 0 ? (
          <div className="rounded-2xl border p-5">
            <div className="text-sm font-semibold">No memberships found</div>
            <div className="text-sm text-muted-foreground mt-1">
              Create a bank or request access.
            </div>
            <div className="mt-3 flex gap-2">
              <Link className="rounded-xl border px-4 py-2 text-sm font-semibold" href="/tenant/create">Create bank</Link>
              <Link className="rounded-xl border px-4 py-2 text-sm font-semibold" href="/ops">Ops</Link>
            </div>
          </div>
        ) : (
          visibleRows.map((r) => (
            <form
              key={r.bank_id}
              action="/api/tenant/select"
              method="post"
              className="rounded-2xl border p-5 flex items-center justify-between gap-3"
            >
              <input type="hidden" name="bank_id" value={r.bank_id} />
              <div>
                <div className="text-sm font-semibold">{r.banks?.name ?? r.bank_id}</div>
                <div className="text-xs text-muted-foreground mt-1">Role: {r.role}</div>
              </div>
              <button className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground">
                Select
              </button>
            </form>
          ))
        )}
      </div>
    </div>
  );
}
