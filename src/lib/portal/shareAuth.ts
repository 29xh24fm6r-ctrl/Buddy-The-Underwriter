// src/lib/portal/shareAuth.ts
import { getShareLinkByToken, isShareLinkValid } from "@/lib/portal/shareLinks";

export async function requireValidShareToken(req: Request) {
  const url = new URL(req.url);

  // Accept either:
  // - query ?token=...
  // - header x-share-token
  const token = url.searchParams.get("token") || req.headers.get("x-share-token");
  if (!token) throw new Error("Missing share token.");

  const row = await getShareLinkByToken(token);
  const valid = isShareLinkValid(row);
  if (!valid.ok) throw new Error(`Invalid share link: ${valid.reason}`);

  return {
    token,
    share: row,
    dealId: String(row.deal_id),
    checklistItemIds: (row.checklist_item_ids ?? []).map((x: any) => String(x)),
  };
}
