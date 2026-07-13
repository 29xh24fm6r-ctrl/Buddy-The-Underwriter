import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { clerkClient } from "@/lib/auth/clerkServer";

export type PortalBankerContact = { name: string | null; email: string | null };

/**
 * Resolve a borrower-safe contact for the portal's "Need help?" card. Prefers
 * the deal's assigned underwriter (deal_participants), falls back to a
 * bank_admin on the same deal, and finally falls back to just the bank's
 * name (no email) so the CTA never points at a random/unassigned staffer.
 * Never throws — a lookup failure just means no contact card shows a name.
 */
async function resolveBankerContact(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string | null,
): Promise<PortalBankerContact | null> {
  try {
    const { data: participants } = await sb
      .from("deal_participants")
      .select("clerk_user_id, role")
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .in("role", ["underwriter", "bank_admin"]);

    const assigned =
      (participants ?? []).find((p: any) => p.role === "underwriter") ??
      (participants ?? []).find((p: any) => p.role === "bank_admin") ??
      null;

    if (assigned?.clerk_user_id) {
      const client = await clerkClient();
      if (client) {
        const user = await client.users.getUser(assigned.clerk_user_id);
        const name = user?.firstName
          ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
          : null;
        const email =
          user?.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId)
            ?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
        if (name || email) return { name, email };
      }
    }
  } catch (err) {
    console.error("[portal/context] resolveBankerContact failed", err);
  }

  if (bankId) {
    try {
      const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();
      if (bank?.name) return { name: bank.name, email: null };
    } catch (err) {
      console.error("[portal/context] bank name fallback failed", err);
    }
  }

  return null;
}

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;

  const { data: link, error } = await sb
    .from("borrower_portal_links")
    .select("deal_id, label, single_use, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the token isn't a portal link, fall back to a borrower_invites token so
  // the deal-workspace invite flow renders the same portal (the two token
  // systems were previously disjoint, leaving invited borrowers with a blank
  // portal header/checklist).
  let dealId = link?.deal_id ?? null;
  let linkMeta: { label: string | null; single_use: boolean | null; expires_at: string | null } = {
    label: link?.label ?? null,
    single_use: link?.single_use ?? null,
    expires_at: link?.expires_at ?? null,
  };
  if (!link) {
    try {
      const resolved = await resolveBorrowerToken(token);
      dealId = resolved.deal_id;
      linkMeta = { label: resolved.name ?? null, single_use: true, expires_at: null };
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }
  } else {
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Token expired" }, { status: 410 });
    }
    // Optional: mark used_at for single-use on first visit
    if (link.single_use && !link.used_at) {
      await sb.from("borrower_portal_links").update({ used_at: new Date().toISOString() }).eq("token", token);
    }
  }

  // Pull minimal deal info for header
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, name, borrower_name, borrower_email, status, stage, city, state, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

  const bankerContact = dealId
    ? await resolveBankerContact(sb, dealId, (deal as { bank_id?: string } | null)?.bank_id ?? null)
    : null;

  let franchiseBrandName: string | null = null;
  if (dealId) {
    const { data: franchiseLink } = await sb
      .from("deal_franchises")
      .select("brand_id")
      .eq("deal_id", dealId)
      .maybeSingle();
    if (franchiseLink?.brand_id) {
      const { data: brand } = await sb
        .from("franchise_brands")
        .select("brand_name")
        .eq("id", franchiseLink.brand_id)
        .maybeSingle();
      franchiseBrandName = brand?.brand_name ?? null;
    }
  }

  return NextResponse.json({
    token,
    deal,
    link: linkMeta,
    franchise: franchiseBrandName ? { brandName: franchiseBrandName } : null,
    bankerContact,
  });
}
