import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { writeDealEvent } from "@/lib/events/dealEvents";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import crypto from "crypto";
import { fetchDealBankId } from "@/lib/deals/fetchDealContext";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Parse request body
  const body = await req.json();
  const { role, statement } = body;

  if (!role || !statement) {
    return NextResponse.json({ error: "role and statement are required" }, { status: 400 });
  }

  // Get authenticated user
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify deal belongs to bank
  const dealBankId = await fetchDealBankId(dealId);
  if (dealBankId !== bankId) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Fetch snapshot
  const { data: snapshot, error: snapErr } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .single();

  if (snapErr || !snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  // Only allow attestation on final snapshots
  if (snapshot.status !== "final") {
    return NextResponse.json(
      { error: "Can only attest final decisions", currentStatus: snapshot.status },
      { status: 400 }
    );
  }

  // Compute snapshot hash (deterministic)
  const payload = JSON.stringify(snapshot, Object.keys(snapshot).sort());
  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  // Create attestation
  const { data: attestation, error: insertErr } = await sb
    .from("decision_attestations")
    .insert({
      decision_snapshot_id: snapshotId,
      deal_id: dealId,
      bank_id: bankId,
      attested_by_user_id: userId,
      attested_by_name: null, // Can be populated from Clerk user metadata
      attested_role: role,
      statement,
      snapshot_hash: hash,
    })
    .select("*")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  // Write to deal events (audit trail)
  await writeDealEvent({
    dealId,
    bankId,
    kind: "decision.attested",
    actorUserId: userId,
    actorRole: role,
    title: `Decision attested by ${role}`,
    payload: {
      snapshotId,
      attestationId: attestation.id,
      role,
      hash,
      statement: statement.substring(0, 100), // Truncate for events log
    },
  });

  return NextResponse.json({ attestation }, { status: 201 });
}

// GET: Fetch all attestations for a snapshot
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Verify deal belongs to bank
  const dealBankId = await fetchDealBankId(dealId);
  if (dealBankId !== bankId) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Fetch attestations
  const { data: attestations, error } = await sb
    .from("decision_attestations")
    .select("*")
    .eq("decision_snapshot_id", snapshotId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attestations });
}
