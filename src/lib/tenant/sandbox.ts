import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";

const SANDBOX_BANK_CODE = "SANDBOX";

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function extractDomain(email?: string | null) {
  const value = normalizeEmail(email);
  const parts = value.split("@");
  if (parts.length !== 2) return "";
  return parts[1] || "";
}

async function resolveSandboxBankId() {
  const sb = supabaseAdmin();
  const { data: existing, error } = await sb
    .from("banks")
    .select("id, code, is_sandbox")
    .eq("code", SANDBOX_BANK_CODE)
    .maybeSingle();

  if (error) throw error;
  if (existing?.id) return String(existing.id);

  const { data: created, error: createErr } = await sb
    .from("banks")
    .insert({
      code: SANDBOX_BANK_CODE,
      name: "External Banker Sandbox",
      is_sandbox: true,
    })
    .select("id")
    .single();

  if (createErr) throw createErr;
  return String(created.id);
}

async function isAllowlistedByEmail(email: string) {
  const sb = supabaseAdmin();
  const normalizedEmail = normalizeEmail(email);
  const domain = extractDomain(normalizedEmail);

  if (!normalizedEmail && !domain) return false;

  const orFilters = [] as string[];
  if (normalizedEmail) orFilters.push(`email.eq.${normalizedEmail}`);
  if (domain) orFilters.push(`domain.eq.${domain}`);

  const { data, error } = await sb
    .from("sandbox_access_allowlist")
    .select("id")
    .eq("enabled", true)
    .or(orFilters.join(","))
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function getPrimaryEmail(): Promise<string | null> {
  const user = await clerkCurrentUser();
  if (!user) return null;
  const primary = user.emailAddresses?.find(
    (e) => e.id === user.primaryEmailAddressId,
  );
  return normalizeEmail(primary?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null);
}

export async function isSandboxBank(bankId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("banks")
    .select("id, is_sandbox, code")
    .eq("id", bankId)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean(data.is_sandbox || data.code === SANDBOX_BANK_CODE);
}

export async function isSandboxAccessAllowed(): Promise<boolean> {
  const email = await getPrimaryEmail();
  if (!email) return false;
  return isAllowlistedByEmail(email);
}

export async function ensureSandboxGate(bankId: string, userId: string) {
  const isSandbox = await isSandboxBank(bankId);
  if (!isSandbox) return;
  const email = await getPrimaryEmail();
  if (!email) throw new Error("sandbox_forbidden");
  const allowed = await isAllowlistedByEmail(email);
  if (!allowed) throw new Error("sandbox_forbidden");

  // Ensure membership is present for allowlisted users
  const sb = supabaseAdmin();
  const { data: membership, error: memErr } = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!membership) {
    const { error: insErr } = await sb.from("bank_memberships").insert({
      bank_id: bankId,
      clerk_user_id: userId,
      role: "bank_admin",
    });
    if (insErr) throw insErr;
  }
}

export async function ensureSandboxMembership(userId: string): Promise<{ ok: boolean; bankId?: string }> {
  const email = await getPrimaryEmail();
  if (!email) return { ok: false };
  const allowed = await isAllowlistedByEmail(email);
  if (!allowed) return { ok: false };

  const bankId = await resolveSandboxBankId();
  const sb = supabaseAdmin();

  const { data: membership, error: memErr } = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (memErr) throw memErr;

  if (!membership) {
    const { error: insErr } = await sb.from("bank_memberships").insert({
      bank_id: bankId,
      clerk_user_id: userId,
      role: "bank_admin",
    });

    if (insErr) throw insErr;
  }

  await sb
    .from("profiles")
    .upsert(
      {
        clerk_user_id: userId,
        bank_id: bankId,
        last_bank_id: bankId,
        bank_selected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" },
    );

  return { ok: true, bankId };
}

export async function getSandboxAccessDetails(): Promise<{ allowed: boolean; email: string | null }> {
  const { userId } = await clerkAuth();
  if (!userId) return { allowed: false, email: null };
  const email = await getPrimaryEmail();
  if (!email) return { allowed: false, email: null };
  const allowed = await isAllowlistedByEmail(email);
  return { allowed, email };
}
