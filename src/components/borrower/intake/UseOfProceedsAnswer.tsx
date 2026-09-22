"use client";
const CATEGORIES = [
  "business_acquisition",
  "purchase_or_construction",
  "equipment",
  "working_capital",
  "inventory",
  "debt_refinance",
  "other",
];
export function UseOfProceedsAnswer({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  let rows: Array<{
    category: string;
    description: string;
    amount: string | number;
  }>;
  try {
    const parsed = JSON.parse(value);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    rows = [];
  }
  if (!rows.length)
    rows = [
      {
        category: "other",
        description: value && !value.startsWith("[") ? value : "",
        amount: "",
      },
    ];
  const update = (index: number, key: string, next: string) =>
    onChange(
      JSON.stringify(
        rows.map((row, i) => (i === index ? { ...row, [key]: next } : row)),
      ),
    );
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">Include every project cost, whether paid by the loan, your contribution, or another funding source. Buddy compares this budget with your funding before preparing the package. Do not count the same cost twice.</p>
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
        >
          <label className="text-sm">
            Purpose
            <select
              disabled={disabled}
              className="mt-1 block w-full rounded border p-2"
              value={row.category}
              onChange={(e) => update(i, "category", e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Amount
            <input
              disabled={disabled}
              className="mt-1 block w-full rounded border p-2"
              type="number"
              min="0"
              step="0.01"
              value={row.amount}
              onChange={(e) => update(i, "amount", e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Description
            <input
              disabled={disabled}
              className="mt-1 block w-full rounded border p-2"
              value={row.description}
              onChange={(e) => update(i, "description", e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={disabled || rows.length === 1}
            className="text-left text-xs underline"
            onClick={() =>
              onChange(JSON.stringify(rows.filter((_, n) => n !== i)))
            }
          >
            Remove line
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="text-sm font-medium text-sky-700 underline"
        onClick={() =>
          onChange(
            JSON.stringify([
              ...rows,
              { category: "other", description: "", amount: "" },
            ]),
          )
        }
      >
        Add another purpose
      </button>
      <p className="text-xs text-slate-500">
        Saving confirms your categories and amounts. Describe construction or
        renovation explicitly when included.
      </p>
    </div>
  );
}
