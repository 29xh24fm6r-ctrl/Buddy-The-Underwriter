import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { UploadPageClient } from "./client";

export default async function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = supabaseAdmin();

  // Validate token
  const { data: link, error } = await sb
    .from("borrower_portal_links")
    .select("id, deal_id, expires_at, used_at")
    .eq("token", token)
    .single();

  if (error || !link) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="rounded-2xl bg-white text-neutral-900 p-6 shadow-lg max-w-md">
          <h1 className="text-lg font-semibold">Invalid or expired link</h1>
          <p className="mt-2 text-sm text-neutral-600">
            This upload link is no longer valid. Please contact your lender for a fresh link.
          </p>
        </div>
      </div>
    );
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="rounded-2xl bg-white text-neutral-900 p-6 shadow-lg max-w-md">
          <h1 className="text-lg font-semibold">Link expired</h1>
          <p className="mt-2 text-sm text-neutral-600">
            This upload link has expired. Please contact your lender for a fresh link.
          </p>
        </div>
      </div>
    );
  }

  // Mark as used
  if (!link.used_at) {
    await sb.from("borrower_portal_links").update({ used_at: new Date().toISOString() }).eq("id", link.id);
  }

  return <UploadPageClient token={token} />;
}
