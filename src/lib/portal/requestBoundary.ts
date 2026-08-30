export const PORTAL_NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL = /^[a-z0-9_-]{1,32}$/i;

export type PortalLinkInput = {
  dealId: string;
  label: string;
  expiresHours: number;
  singleUse: boolean;
  channel: string | null;
};

export function parsePortalLinkInput(value: unknown): PortalLinkInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const dealId = typeof body.deal_id === "string" ? body.deal_id.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "Borrower docs";
  const expiresHours = body.expires_hours === undefined ? 72 : body.expires_hours;
  const singleUse = body.single_use === undefined ? true : body.single_use;
  const channel = body.channel === undefined || body.channel === null ? null : body.channel;

  if (!UUID.test(dealId)) return null;
  if (!label || label.length > 120) return null;
  if (!Number.isSafeInteger(expiresHours) || Number(expiresHours) < 1 || Number(expiresHours) > 720) return null;
  if (typeof singleUse !== "boolean") return null;
  if (channel !== null && (typeof channel !== "string" || !CHANNEL.test(channel))) return null;

  return { dealId, label, expiresHours: Number(expiresHours), singleUse, channel: channel as string | null };
}

export function parsePortalToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token.length >= 16 && token.length <= 512 ? token : null;
}

export function parsePortalMessage(body: unknown, authorName: unknown) {
  if (typeof body !== "string") return null;
  const message = body.trim();
  if (!message || message.length > 4_000) return null;
  if (authorName !== undefined && authorName !== null && typeof authorName !== "string") return null;
  const author = typeof authorName === "string" ? authorName.trim() : "";
  if (author.length > 120) return null;
  return { body: message, authorName: author || null };
}

export function resolvePortalOrigin(raw: string | undefined, nodeEnv: string | undefined): string | null {
  if (!raw) return nodeEnv === "production" ? null : "http://localhost:3000";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(nodeEnv !== "production" && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
