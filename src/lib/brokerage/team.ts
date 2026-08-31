import "server-only";

import { clerkClient } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";

/**
 * Who is on the brokerage tenant, with display names resolved.
 *
 * Assignment was the one thing the brokerage operating system modelled
 * everywhere and surfaced nowhere: deals.brokerage_stage_owner_clerk_user_id
 * and brokerage_tasks.assigned_to_clerk_user_id both existed, with working
 * endpoints, and no screen ever wrote to them. Every screen that assigns
 * work needs the same roster, so it lives here rather than being rebuilt per
 * page — a clerk_user_id is not something a person can pick from.
 */

export type BrokerageTeamMember = {
  clerkUserId: string;
  name: string;
  email: string | null;
  role: string;
};

function displayName(
  user: { firstName?: string | null; lastName?: string | null; emailAddresses?: Array<{ emailAddress: string }> } | undefined,
  fallbackId: string,
): string {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (email) return email;
  return `Teammate ${fallbackId.slice(-6)}`;
}

/**
 * Returns the roster, oldest membership first. Never throws: an unavailable
 * Clerk must degrade to "you cannot see names", not to a broken pipeline
 * board — assignment still works from the ids the memberships table holds.
 */
export async function listBrokerageTeam(bankId: string): Promise<BrokerageTeamMember[]> {
  const sb = supabaseAdmin();
  const { data: memberships } = await sb
    .from("bank_memberships")
    .select("clerk_user_id, role, created_at")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: true });

  const rows = (memberships ?? []) as Array<{ clerk_user_id: string; role: string }>;
  if (rows.length === 0) return [];

  let userById = new Map<string, any>();
  try {
    const client = await clerkClient();
    if (client) {
      const users = await client.users.getUserList({ limit: 200 });
      userById = new Map(users.data.map((u: any) => [u.id, u]));
    }
  } catch {
    // Names are a convenience; ids still identify the teammate.
  }

  return rows.map((m) => ({
    clerkUserId: m.clerk_user_id,
    name: displayName(userById.get(m.clerk_user_id), m.clerk_user_id),
    email: userById.get(m.clerk_user_id)?.emailAddresses?.[0]?.emailAddress ?? null,
    role: normalizeBuddyRole(m.role) ?? m.role,
  }));
}

/** clerk_user_id → display name, for rendering an owner on a card or row. */
export async function brokerageTeamNameMap(bankId: string): Promise<Record<string, string>> {
  const team = await listBrokerageTeam(bankId);
  return Object.fromEntries(team.map((m) => [m.clerkUserId, m.name]));
}
