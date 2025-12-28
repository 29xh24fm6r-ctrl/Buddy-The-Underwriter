/**
 * GET /api/deals/{dealId}/decision/{snapshotId}/regulator-zip
 * 
 * Exports a comprehensive regulator-ready ZIP bundle containing:
 * - decision_snapshot.json (full snapshot)
 * - attestations.json (chain of custody)
 * - committee_votes.json (voting records)
 * - hash.txt (SHA-256 integrity hash)
 * - manifest.json (metadata about the export)
 * 
 * This is THE definitive export for regulatory examination.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import JSZip from "jszip";
import crypto from "crypto";

type Ctx = { params: Promise<{ dealId: string; snapshotId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch decision snapshot
  const { data: snapshot, error: snapError } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .single();

  if (snapError || !snapshot) {
    return NextResponse.json(
      { ok: false, error: "Decision snapshot not found" },
      { status: 404 }
    );
  }

  // Fetch attestations
  const { data: attestations } = await sb
    .from("decision_attestations")
    .select("*")
    .eq("decision_snapshot_id", snapshotId);

  // Fetch committee votes
  const { data: votes } = await sb
    .from("credit_committee_votes")
    .select("*")
    .eq("decision_snapshot_id", snapshotId);

  // Fetch committee minutes (if generated)
  const { data: minutes } = await sb
    .from("credit_committee_minutes")
    .select("*")
    .eq("decision_snapshot_id", snapshotId)
    .maybeSingle();

  // Fetch dissent opinions (if any)
  const { data: dissent } = await sb
    .from("credit_committee_dissent")
    .select("*")
    .eq("decision_snapshot_id", snapshotId);

  // Fetch deal metadata (for context)
  const { data: deal } = await sb
    .from("deals")
    .select("id, borrower_name, loan_amount, created_at")
    .eq("id", dealId)
    .single();

  // Create ZIP
  const zip = new JSZip();

  // Add decision snapshot
  zip.file("decision_snapshot.json", JSON.stringify(snapshot, null, 2));

  // Add attestations
  zip.file("attestations.json", JSON.stringify(attestations || [], null, 2));

  // Add committee votes
  zip.file("committee_votes.json", JSON.stringify(votes || [], null, 2));

  // Add committee minutes (if generated)
  if (minutes) {
    zip.file("committee_minutes.txt", minutes.content);
  }

  // Add dissent opinions (if any)
  if (dissent && dissent.length > 0) {
    zip.file("dissent.json", JSON.stringify(dissent, null, 2));
  }

  // Calculate integrity hash
  const snapshotPayload = JSON.stringify(snapshot, Object.keys(snapshot).sort());
  const hash = crypto.createHash("sha256").update(snapshotPayload).digest("hex");
  zip.file("hash.txt", hash);

  // Add manifest (export metadata)
  const manifestFiles = [
    "decision_snapshot.json",
    "attestations.json",
    "committee_votes.json",
    "hash.txt",
    "manifest.json"
  ];
  
  if (minutes) manifestFiles.push("committee_minutes.txt");
  if (dissent && dissent.length > 0) manifestFiles.push("dissent.json");

  const manifest = {
    export_version: "1.0",
    export_timestamp: new Date().toISOString(),
    bank_id: bankId,
    deal_id: dealId,
    snapshot_id: snapshotId,
    deal_context: deal,
    integrity_hash: hash,
    files: manifestFiles,
    verification_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://buddy.app'}/api/verify/${hash}`,
    note: "This bundle contains a complete, immutable record of an underwriting decision, attestations, and committee votes. The integrity hash can be used to verify the decision snapshot has not been altered. Visit the verification_url to independently verify this decision."
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // Generate ZIP buffer
  const zipBuffer = await zip.generateAsync({ 
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });

  // Return as downloadable file
  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="decision-${snapshotId.slice(0, 8)}-regulator.zip"`,
      "Content-Length": zipBuffer.length.toString()
    }
  });
}
