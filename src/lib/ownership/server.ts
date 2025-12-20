// src/lib/ownership/provision.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requiresPersonalPackage, ownerChecklistTemplate } from "@/lib/ownership/rules";

function randomToken(len = 48) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function upsertConfirmedOwners(params: {
  dealId: string;
  owners: Array<{ fullName: string; ownershipPercent: number | null; email?: string | null; phone?: string | null }>;
}) {
  const sb = supabaseAdmin();

  const created: any[] = [];

  for (const o of params.owners) {
    const row = {
      deal_id: params.dealId,
      full_name: o.fullName,
      email: o.email ?? null,
      phone: o.phone ?? null,
      ownership_percent: o.ownershipPercent ?? null,
      ownership_source: "borrower_confirmed",
      ownership_confidence: null,
      requires_personal_package: requiresPersonalPackage(o.ownershipPercent ?? null),
    };

    const { data, error } = await sb.from("deal_owners").insert(row).select("*").single();
    if (error) throw error;
    created.push(data);
  }

  return created;
}

export async function ensureOwnerChecklist(ownerId: string, dealId: string) {
  const sb = supabaseAdmin();
  const template = ownerChecklistTemplate();

  await sb.from("deal_owner_checklist_items").upsert(
    template.map((t) => ({
      deal_id: dealId,
      owner_id: ownerId,
      code: t.code,
      title: t.title,
      description: t.description,
      sort_order: t.sort_order,
      required: t.required,
      match_hints: t.match_hints,
    })),
    { onConflict: "owner_id,code" }
  );

  // Ensure state rows exist
  const { data: items } = await sb
    .from("deal_owner_checklist_items")
    .select("id")
    .eq("owner_id", ownerId);

  for (const it of items ?? []) {
    await sb.from("deal_owner_checklist_state").upsert(
      { owner_id: ownerId, item_id: it.id, status: "missing" },
      { onConflict: "owner_id,item_id" }
    );
  }
}

export async function createOwnerPortal(dealId: string, ownerId: string, expiresDays = 14) {
  const sb = supabaseAdmin();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 3600 * 1000).toISOString();

  const { data, error } = await sb
    .from("deal_owner_portals")
    .insert({
      deal_id: dealId,
      owner_id: ownerId,
      status: "invited",
      token,
      expires_at: expiresAt,
      revoked: false,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function queueOwnerInviteEmail(params: {
  dealId: string;
  ownerId: string;
  toEmail: string;
  ownerName: string;
  ownerPortalUrl: string; // absolute
  dealName: string;
}) {
  const sb = supabaseAdmin();

  const subject = `Action needed: upload your documents for ${params.dealName}`;
  const body =
    `Hi ${params.ownerName},\n\n` +
    `You've been invited to a secure portal to upload a short set of personal documents needed for the loan.\n\n` +
    `Secure link: ${params.ownerPortalUrl}\n\n` +
    `If anything is confusing, just reply in the portal and we'll guide you.\n`;

  const { error } = await sb.from("deal_owner_outreach_queue").insert({
    deal_id: params.dealId,
    owner_id: params.ownerId,
    kind: "invite",
    status: "queued",
    to_email: params.toEmail,
    subject,
    body,
  });

  if (error) throw error;
}
