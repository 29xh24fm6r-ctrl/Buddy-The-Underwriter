// src/lib/portal/shareAuth.ts
import {
  getShareLinkByToken,
  isShareLinkValid,
  isValidShareTokenFormat,
} from "@/lib/portal/shareLinks";

export class ShareTokenError extends Error {
  constructor(
    readonly status: 400 | 401 | 503,
    readonly publicCode: "missing_share_token" | "invalid_share_token" | "share_lookup_unavailable",
  ) {
    super(publicCode);
    this.name = "ShareTokenError";
  }
}

export async function requireValidShareToken(req: Request) {
  const url = new URL(req.url);
  const headerToken = req.headers.get("x-share-token");
  const queryToken = url.searchParams.get("token");
  const token = String(headerToken || queryToken || "").trim();
  if (!token) throw new ShareTokenError(401, "missing_share_token");
  if (!isValidShareTokenFormat(token)) throw new ShareTokenError(401, "invalid_share_token");

  let row;
  try {
    row = await getShareLinkByToken(token);
  } catch {
    throw new ShareTokenError(503, "share_lookup_unavailable");
  }
  const valid = isShareLinkValid(row);
  if (!valid.ok) throw new ShareTokenError(401, "invalid_share_token");

  return {
    share: row,
    dealId: row.deal_id,
    checklistItemIds: row.checklist_item_ids.map(String),
  };
}
