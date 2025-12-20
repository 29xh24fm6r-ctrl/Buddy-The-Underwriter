// src/lib/deals/chat.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type DealMessage = {
  id: string;
  deal_id: string;
  sender_role: "banker" | "borrower";
  sender_user_id: string | null;
  sender_display: string | null;
  body: string;
  created_at: string;
};

export type BankerThread = {
  dealId: string;

  dealName: string | null;
  borrowerName: string | null;

  displayLabel: string;
  displaySubtitle: string | null;

  lastMessageAt: string | null;
  lastMessageBody: string;
  lastSenderRole: string | null;
  lastSenderDisplay: string | null;

  unreadBorrowerCount: number;
};

export async function listDealMessages(dealId: string, limit = 200): Promise<DealMessage[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_messages")
    .select("id, deal_id, sender_role, sender_user_id, sender_display, body, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as DealMessage[];
}

export async function sendDealMessage(input: {
  dealId: string;
  senderRole: "banker" | "borrower";
  senderUserId?: string | null;
  senderDisplay?: string | null;
  body: string;
}): Promise<DealMessage> {
  const sb = supabaseAdmin();
  const body = (input.body ?? "").trim();
  if (!body) throw new Error("Message cannot be empty.");

  const { data, error } = await sb
    .from("deal_messages")
    .insert({
      deal_id: input.dealId,
      sender_role: input.senderRole,
      sender_user_id: input.senderUserId ?? null,
      sender_display: input.senderDisplay ?? null,
      body,
      borrower_visible: true,
      banker_visible: true,
    })
    .select("id, deal_id, sender_role, sender_user_id, sender_display, body, created_at")
    .single();

  if (error) throw error;
  return data as DealMessage;
}

export async function bankerMarkDealRead(input: { dealId: string; bankerUserId: string }) {
  const sb = supabaseAdmin();

  const { error } = await sb
    .from("deal_message_reads")
    .upsert(
      {
        deal_id: input.dealId,
        banker_user_id: input.bankerUserId,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,banker_user_id" }
    );

  if (error) throw error;
  return { ok: true };
}

async function fetchDealDisplayInfo(dealIds: string[]) {
  const out = new Map<
    string,
    {
      dealName: string | null;
      borrowerName: string | null;
      displayLabel: string;
      displaySubtitle: string | null;
    }
  >();

  for (const id of dealIds) {
    out.set(id, {
      dealName: null,
      borrowerName: null,
      displayLabel: `Deal ${id.slice(0, 8)}…`,
      displaySubtitle: null,
    });
  }

  if (dealIds.length === 0) return out;

  const sb = supabaseAdmin();

  try {
    const { data, error } = await sb.rpc("deal_display_lookup_v2", { deal_ids: dealIds });
    if (error) return out;

    for (const row of (data ?? []) as any[]) {
      const id = String(row.deal_id);
      out.set(id, {
        dealName: row.deal_name ?? null,
        borrowerName: row.borrower_name ?? null,
        displayLabel: row.display_label ?? `Deal ${id.slice(0, 8)}…`,
        displaySubtitle: row.display_subtitle ?? null,
      });
    }

    return out;
  } catch {
    return out;
  }
}

export async function bankerListMessageThreads(input: { bankerUserId: string; limit?: number }): Promise<BankerThread[]> {
  const sb = supabaseAdmin();
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));

  // Recent messages (reduce to latest per deal)
  const { data: recent, error: rErr } = await sb
    .from("deal_messages")
    .select("deal_id, body, created_at, sender_role, sender_display")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (rErr) throw rErr;

  const latestByDeal = new Map<string, any>();
  for (const m of recent ?? []) {
    if (!latestByDeal.has(m.deal_id)) latestByDeal.set(m.deal_id, m);
  }

  const dealIds = Array.from(latestByDeal.keys()).slice(0, limit);

  // NEW: discover display names via RPC
  const displayMap = await fetchDealDisplayInfo(dealIds);

  // Read receipts
  const { data: reads, error: rrErr } = await sb
    .from("deal_message_reads")
    .select("deal_id, last_read_at")
    .eq("banker_user_id", input.bankerUserId);

  if (rrErr) throw rrErr;

  const readMap = new Map<string, string>();
  for (const r of reads ?? []) readMap.set(r.deal_id, r.last_read_at);

  const threads: BankerThread[] = [];

  for (const dealId of dealIds) {
    const last = latestByDeal.get(dealId);
    const lastReadAt = readMap.get(dealId) ?? "1970-01-01T00:00:00.000Z";

    // unread = borrower messages since last read
    const { count, error: cErr } = await sb
      .from("deal_messages")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("sender_role", "borrower")
      .gt("created_at", lastReadAt);

    if (cErr) throw cErr;

    const display = displayMap.get(dealId)!;

    threads.push({
      dealId,
      dealName: display.dealName,
      borrowerName: display.borrowerName,
      displayLabel: display.displayLabel,
      displaySubtitle: display.displaySubtitle,
      lastMessageAt: last?.created_at ?? null,
      lastMessageBody: last?.body ?? "",
      lastSenderRole: last?.sender_role ?? null,
      lastSenderDisplay: last?.sender_display ?? null,
      unreadBorrowerCount: count ?? 0,
    });
  }

  threads.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  return threads;
}
