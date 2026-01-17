export function isValidClerkPublishableKey(key: string | undefined | null) {
  if (!key) return false;
  const v = String(key).trim();
  if (!v) return false;

  const lowered = v.toLowerCase();
  if (lowered.includes("placeholder")) return false;
  if (lowered.includes("your_")) return false;
  if (lowered.includes("changeme")) return false;
  if (v === "pk_test" || v === "pk_live") return false;

  if (!/^pk_(test|live)_[a-z0-9]+/i.test(v)) return false;

  return true;
}
