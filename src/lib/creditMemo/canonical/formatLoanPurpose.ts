/** Convert the saved loan request to narrative text without coercing JSON objects. */
export function formatLoanPurpose(purpose: unknown, proceeds: unknown): string {
  const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
  const explicit = text(purpose);
  if (explicit) return explicit;
  if (typeof proceeds === "string") return text(proceeds) || "Pending";
  if (!Array.isArray(proceeds)) return "Pending";

  const lines = proceeds.flatMap((item: unknown) => {
    if (typeof item === "string") return text(item) ? [text(item)] : [];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const label = [text(row.category), text(row.description)].filter(Boolean).join(": ");
    if (!label) return [];
    const amount = typeof row.amount === "number" ? row.amount :
      typeof row.amount === "string" && row.amount.trim() ? Number(row.amount) : NaN;
    return [Number.isFinite(amount)
      ? `${label} (${amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })})`
      : label];
  });
  return lines.join("; ") || "Pending";
}
