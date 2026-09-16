export function normalizeBusinessWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!url.hostname || !url.hostname.includes(".")) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function businessWebsiteDomain(value: string | null | undefined): string | null {
  const normalized = normalizeBusinessWebsite(value ?? "");
  if (!normalized) return null;

  return new URL(normalized).hostname.replace(/^www\./i, "");
}

export function businessLogoUrl(value: string | null | undefined): string | null {
  const domain = businessWebsiteDomain(value);
  return domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
    : null;
}
