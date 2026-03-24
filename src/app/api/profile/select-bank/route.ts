import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxAccessAllowed } from "@/lib/tenant/sandbox";
import { activateBank } from "@/lib/tenant/activateBank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG = "[POST /api/profile/select-bank]";

/**
 * POST /api/profile/select-bank
 *
 * Select an existing bank. If the user already has a membership,
 * switches the active bank. If not, creates a membership with role
 * "member" and switches.
 *
 * Self-attachment is allowed — no admin approval required.
 * New members receive "member" role (not "admin").
 */
export async function POST(req: NextRequest) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}) as any);
  const bankId = String(body?.bank_id || "").trim();

  if (!bankId) {
    return NextResponse.json(
      { ok: false, error: "missing_bank_id" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // 1. Fetch bank
  const { data: bank, error: bankErr } = await sb
    .from("banks")
    .select("id, name, logo_url, website_url, is_sandbox")
    .eq("id", bankId)
    .maybeSingle();

  if (bankErr) {
    console.error(`${TAG} bank lookup failed:`, bankErr.message);
    return NextResponse.json(
      { ok: false, error: "bank_not_found", detail: "Could not look up the bank." },
      { status: 500 },
    );
  }

  if (!bank) {
    return NextResponse.json(
      { ok: false, error: "bank_not_found", detail: "That bank does not exist." },
      { status: 404 },
    );
  }

  // 2. Sandbox gate
  if (bank.is_sandbox) {
    const sandboxAllowed = await isSandboxAccessAllowed();
    if (!sandboxAllowed) {
      return NextResponse.json(
        { ok: false, error: "bank_is_sandbox", detail: "Sandbox banks are not available." },
        { status: 403 },
      );
    }
  }

  // 3. Check existing membership
  const { data: mem } = await sb
    .from("bank_memberships")
    .select("bank_id, role")
    .eq("clerk_user_id", userId)
    .eq("bank_id", bankId)
    .maybeSingle();

  const alreadyMember = !!mem;

  // 4. Activate — profile → membership → context
  const result = await activateBank(userId, bankId, bank, {
    existing: alreadyMember,
    skipMembership: alreadyMember,
    role: alreadyMember ? (mem!.role ?? "member") : "member",
    callerTag: TAG,
  });

  // 5. Augment response with `attached` flag
  const resultBody = await result.clone().json();
  if (resultBody.ok) {
    const augmented = NextResponse.json(
      { ...resultBody, attached: !alreadyMember },
      { status: result.status },
    );
    // Copy cookies from the original response
    for (const cookie of result.cookies.getAll()) {
      augmented.cookies.set(cookie);
    }
    return augmented;
  }

  // Activation failed — log and return as-is
  console.error(`${TAG} activation failed:`, {
    userId,
    bankId,
    bankName: bank.name,
    alreadyMember,
    error: resultBody.error,
  });

  return result;
}
