import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { RenderedSpread, RenderedSpreadCellV2, RentRollRow, SpreadColumnV2 } from "@/lib/financialSpreads/types";

type RentRollColumnKey =
  | "UNIT"
  | "TENANT"
  | "STATUS"
  | "SQFT"
  | "RENT_MO"
  | "RENT_YR"
  | "MARKET_RENT_MO"
  | "LEASE_START"
  | "LEASE_END"
  | "WALT_YEARS"
  | "NOTES";

type NormalizedRentRollRow = {
  id: string;
  unit_id: string;
  tenant_name: string | null;
  occupancy_status: "OCCUPIED" | "VACANT";
  unit_type: string | null;
  sqft: number | null;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number | null;
  annual_rent: number | null;
  market_rent_monthly: number | null;
  concessions_monthly: number | null;
  notes: string | null;
  source_document_id: string | null;
  as_of_date: string; // YYYY-MM-DD
};

function formatCurrency(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatInteger(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatNumber(v: number, digits = 2): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function isIsoDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseIsoUTC(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d));
}

export function buildRentRollColumnsV2(): SpreadColumnV2[] {
  const cols: Array<{ key: RentRollColumnKey; label: string }> = [
    { key: "UNIT", label: "Unit" },
    { key: "TENANT", label: "Tenant" },
    { key: "STATUS", label: "Status" },
    { key: "SQFT", label: "Sqft" },
    { key: "RENT_MO", label: "Rent / Mo" },
    { key: "RENT_YR", label: "Rent / Yr" },
    { key: "MARKET_RENT_MO", label: "Market Rent / Mo" },
    { key: "LEASE_START", label: "Lease Start" },
    { key: "LEASE_END", label: "Lease End" },
    { key: "WALT_YEARS", label: "WALT (yrs)" },
    { key: "NOTES", label: "Notes" },
  ];

  return cols.map((c) => ({ key: c.key, label: c.label, kind: "other" }));
}

function normalizeRentRollRows(inputRows: RentRollRow[], asOfDate: string): NormalizedRentRollRow[] {
  return inputRows
    .filter((r) => String(r.as_of_date ?? "") === asOfDate)
    .map((r) => {
      const monthly = typeof r.monthly_rent === "number" ? r.monthly_rent : null;
      const annual = typeof r.annual_rent === "number" ? r.annual_rent : null;

      const derivedAnnual = annual ?? (monthly !== null ? monthly * 12 : null);
      const derivedMonthly = monthly ?? (annual !== null ? annual / 12 : null);

      return {
        id: String(r.id),
        unit_id: String(r.unit_id ?? ""),
        tenant_name: r.tenant_name === null || r.tenant_name === undefined ? null : String(r.tenant_name),
        occupancy_status: r.occupancy_status === "OCCUPIED" ? "OCCUPIED" : "VACANT",
        unit_type: r.unit_type === null || r.unit_type === undefined ? null : String(r.unit_type),
        sqft: typeof r.sqft === "number" ? r.sqft : null,
        lease_start: isIsoDate(r.lease_start) ? r.lease_start : null,
        lease_end: isIsoDate(r.lease_end) ? r.lease_end : null,
        monthly_rent: derivedMonthly,
        annual_rent: derivedAnnual,
        market_rent_monthly: typeof r.market_rent_monthly === "number" ? r.market_rent_monthly : null,
        concessions_monthly: typeof r.concessions_monthly === "number" ? r.concessions_monthly : null,
        notes: r.notes === null || r.notes === undefined ? null : String(r.notes),
        source_document_id: r.source_document_id === null || r.source_document_id === undefined ? null : String(r.source_document_id),
        as_of_date: asOfDate,
      };
    });
}

function sortRentRollRows(rows: NormalizedRentRollRow[]): NormalizedRentRollRow[] {
  return rows
    .slice()
    .sort((a, b) => {
      const ua = a.unit_id;
      const ub = b.unit_id;
      if (ua < ub) return -1;
      if (ua > ub) return 1;

      const taNull = a.tenant_name === null || a.tenant_name.trim() === "";
      const tbNull = b.tenant_name === null || b.tenant_name.trim() === "";
      if (taNull !== tbNull) return taNull ? 1 : -1;

      const ta = (a.tenant_name ?? "").toLowerCase();
      const tb = (b.tenant_name ?? "").toLowerCase();
      if (ta < tb) return -1;
      if (ta > tb) return 1;

      // Deterministic tie-break.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function computeWaltYears(args: { leaseEnd: string | null; asOfDate: string | null; occupied: boolean }): number | null {
  if (!args.occupied) return null;
  if (!args.leaseEnd || !args.asOfDate) return null;
  const end = parseIsoUTC(args.leaseEnd);
  const asOf = parseIsoUTC(args.asOfDate);
  if (!end || !asOf) return null;

  const diffDays = (end.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24);
  const years = diffDays / 365.25;
  return Math.max(0, years);
}

function buildRowCell(args: {
  cols: SpreadColumnV2[];
  values: Record<RentRollColumnKey, string | number | null>;
  display: Partial<Record<RentRollColumnKey, string | null>>;
  provenance: Partial<Record<RentRollColumnKey, any | null>>;
}): RenderedSpreadCellV2 {
  const valueByCol: Record<string, string | number | null> = {};
  const displayByCol: Record<string, string | null> = {};
  const provenanceByCol: Record<string, any | null> = {};

  for (const c of args.cols) {
    const key = c.key as RentRollColumnKey;
    valueByCol[c.key] = args.values[key] ?? null;
    displayByCol[c.key] = (args.display[key] ?? null) as any;
    provenanceByCol[c.key] = (args.provenance[key] ?? null) as any;
  }

  return {
    value: null,
    valueByCol,
    displayByCol,
    provenanceByCol,
  };
}

function sum(values: Array<number | null | undefined>): number | null {
  let s = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

function computeTotals(rows: NormalizedRentRollRow[]) {
  const occupied = rows.filter((r) => r.occupancy_status === "OCCUPIED");
  const vacant = rows.filter((r) => r.occupancy_status === "VACANT");

  const totalOccupiedRentMo = sum(occupied.map((r) => r.monthly_rent));
  const totalOccupiedSqft = sum(occupied.map((r) => r.sqft));
  const totalSqft = sum(rows.map((r) => r.sqft));

  const occupancyPct =
    typeof totalOccupiedSqft === "number" && typeof totalSqft === "number" && totalSqft !== 0
      ? totalOccupiedSqft / totalSqft
      : null;
  const vacancyPct = occupancyPct === null ? null : 1 - occupancyPct;

  return {
    totalOccupiedRentMo,
    totalOccupiedSqft,
    totalSqft,
    occupancyPct,
    vacancyPct,
    totalsByStatus: {
      occupied: {
        rent_mo: totalOccupiedRentMo,
        rent_yr: totalOccupiedRentMo === null ? null : totalOccupiedRentMo * 12,
        sqft: totalOccupiedSqft,
      },
      vacant: {
        rent_mo: sum(vacant.map((r) => r.monthly_rent)),
        rent_yr: (() => {
          const m = sum(vacant.map((r) => r.monthly_rent));
          return m === null ? null : m * 12;
        })(),
        sqft: sum(vacant.map((r) => r.sqft)),
      },
      all: {
        rent_mo: sum(rows.map((r) => r.monthly_rent)),
        rent_yr: (() => {
          const m = sum(rows.map((r) => r.monthly_rent));
          return m === null ? null : m * 12;
        })(),
        sqft: totalSqft,
      },
    },
  };
}

function totalsRow(args: {
  cols: SpreadColumnV2[];
  key: "TOTAL_OCCUPIED" | "TOTAL_VACANT" | "TOTALS";
  label: string;
  status: "OCCUPIED" | "VACANT" | "ALL";
  rentMo: number | null;
  rentYr: number | null;
  sqft: number | null;
  asOfDate: string;
}): { key: string; label: string; values: [RenderedSpreadCellV2] } {
  const values: Record<RentRollColumnKey, string | number | null> = {
    UNIT: args.label,
    TENANT: null,
    STATUS: args.status,
    SQFT: args.sqft,
    RENT_MO: args.rentMo,
    RENT_YR: args.rentYr,
    MARKET_RENT_MO: null,
    LEASE_START: null,
    LEASE_END: null,
    WALT_YEARS: null,
    NOTES: null,
  };

  const display: Partial<Record<RentRollColumnKey, string | null>> = {
    UNIT: args.label,
    STATUS: args.status,
    SQFT: args.sqft === null ? null : formatInteger(args.sqft),
    RENT_MO: args.rentMo === null ? null : formatCurrency(args.rentMo),
    RENT_YR: args.rentYr === null ? null : formatCurrency(args.rentYr),
  };

  const provenance: Partial<Record<RentRollColumnKey, any | null>> = {
    UNIT: { source: "Computed" },
    STATUS: { source: "Computed" },
    SQFT: { source: "Computed" },
    RENT_MO: { source: "Computed" },
    RENT_YR: { source: "Computed" },
  };

  const cell = buildRowCell({ cols: args.cols, values, display, provenance });
  return { key: args.key, label: args.label, values: [cell] };
}

function deriveLatestAsOfDate(rows: RentRollRow[]): string | null {
  let out: string | null = null;
  for (const r of rows) {
    const d = String((r as any).as_of_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!out || d > out) out = d;
  }
  return out;
}

export function rentRollTemplate(): SpreadTemplate {
  const title = "Rent Roll (Canonical)";

  return {
    spreadType: "RENT_ROLL",
    title,
    version: 3,
    columns: ["Unit", "Tenant", "Status", "Sqft", "Rent / Mo", "Rent / Yr"],
    render: (args): RenderedSpread => {
      const cols = buildRentRollColumnsV2();
      const rawRows = Array.isArray(args.rentRollRows) ? args.rentRollRows : [];
      const asOf = deriveLatestAsOfDate(rawRows);

      if (!asOf) {
        return {
          schema_version: 3,
          schemaVersion: 3,
          title,
          spread_type: "RENT_ROLL",
          status: "ready",
          generatedAt: new Date().toISOString(),
          asOf: null,
          columns: cols.map((c) => c.label),
          columnsV2: cols,
          rows: [
            {
              key: "no_data",
              label: "No normalized rent roll rows",
              section: null,
              values: [
                {
                  value: null,
                  valueByCol: Object.fromEntries(cols.map((c) => [c.key, null])),
                  displayByCol: Object.fromEntries(cols.map((c) => [c.key, "—"])),
                  provenanceByCol: Object.fromEntries(cols.map((c) => [c.key, { source: "Missing" }])),
                },
              ],
              notes: "Populate deal_rent_roll_rows to render the canonical RENT_ROLL spread.",
            },
          ],
          meta: {
            template: "canonical_rent_roll_v1",
            version: 3,
            as_of_selected: null,
          },
          totals: {
            TOTAL_OCCUPIED_RENT_MO: null,
            TOTAL_OCCUPIED_SQFT: null,
            TOTAL_SQFT: null,
            OCCUPANCY_PCT: null,
            VACANCY_PCT: null,
          },
        };
      }

      const normalized = sortRentRollRows(normalizeRentRollRows(rawRows, asOf));

      const unitRows = normalized.map((r) => {
        const occupied = r.occupancy_status === "OCCUPIED";
        const walt = computeWaltYears({ leaseEnd: r.lease_end, asOfDate: asOf, occupied });

        const values: Record<RentRollColumnKey, string | number | null> = {
          UNIT: r.unit_id,
          TENANT: r.tenant_name,
          STATUS: r.occupancy_status,
          SQFT: r.sqft,
          RENT_MO: r.monthly_rent,
          RENT_YR: r.annual_rent,
          MARKET_RENT_MO: r.market_rent_monthly,
          LEASE_START: r.lease_start,
          LEASE_END: r.lease_end,
          WALT_YEARS: walt,
          NOTES: r.notes,
        };

        const display: Partial<Record<RentRollColumnKey, string | null>> = {
          UNIT: r.unit_id,
          TENANT: r.tenant_name,
          STATUS: r.occupancy_status,
          SQFT: r.sqft === null ? null : formatInteger(r.sqft),
          RENT_MO: r.monthly_rent === null ? null : formatCurrency(r.monthly_rent),
          RENT_YR: r.annual_rent === null ? null : formatCurrency(r.annual_rent),
          MARKET_RENT_MO: r.market_rent_monthly === null ? null : formatCurrency(r.market_rent_monthly),
          LEASE_START: r.lease_start,
          LEASE_END: r.lease_end,
          WALT_YEARS: walt === null ? null : formatNumber(walt, 2),
          NOTES: r.notes,
        };

        const provenance: Partial<Record<RentRollColumnKey, any | null>> = {
          UNIT: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          TENANT: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          STATUS: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          SQFT: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          RENT_MO: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          RENT_YR: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          MARKET_RENT_MO: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          LEASE_START: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          LEASE_END: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
          WALT_YEARS: { source: "Computed", as_of_date: asOf },
          NOTES: { source: "RentRollRow", row_id: r.id, source_document_id: r.source_document_id },
        };

        const cell = buildRowCell({ cols, values, display, provenance });

        return {
          key: `ROW:${r.unit_id}:${r.tenant_name ?? ""}:${r.id}`,
          label: r.unit_id,
          section: null,
          values: [cell],
        };
      });

      const totals = computeTotals(normalized);

      const totalRows = [
        totalsRow({
          cols,
          key: "TOTAL_OCCUPIED",
          label: "TOTAL OCCUPIED",
          status: "OCCUPIED",
          rentMo: totals.totalsByStatus.occupied.rent_mo,
          rentYr: totals.totalsByStatus.occupied.rent_yr,
          sqft: totals.totalsByStatus.occupied.sqft,
          asOfDate: asOf,
        }),
        totalsRow({
          cols,
          key: "TOTAL_VACANT",
          label: "TOTAL VACANT",
          status: "VACANT",
          rentMo: totals.totalsByStatus.vacant.rent_mo,
          rentYr: totals.totalsByStatus.vacant.rent_yr,
          sqft: totals.totalsByStatus.vacant.sqft,
          asOfDate: asOf,
        }),
        totalsRow({
          cols,
          key: "TOTALS",
          label: "TOTALS",
          status: "ALL",
          rentMo: totals.totalsByStatus.all.rent_mo,
          rentYr: totals.totalsByStatus.all.rent_yr,
          sqft: totals.totalsByStatus.all.sqft,
          asOfDate: asOf,
        }),
      ];

      return {
        schema_version: 3,
        schemaVersion: 3,
        title,
        spread_type: "RENT_ROLL",
        status: "ready",
        generatedAt: new Date().toISOString(),
        asOf,
        columns: cols.map((c) => c.label),
        columnsV2: cols,
        rows: [...unitRows, ...totalRows],
        totals: {
          TOTAL_OCCUPIED_RENT_MO: totals.totalOccupiedRentMo,
          TOTAL_OCCUPIED_SQFT: totals.totalOccupiedSqft,
          TOTAL_SQFT: totals.totalSqft,
          OCCUPANCY_PCT: totals.occupancyPct,
          VACANCY_PCT: totals.vacancyPct,
        },
        meta: {
          template: "canonical_rent_roll_v1",
          version: 3,
          as_of_selected: asOf,
          column_registry: cols.map((c) => c.key),
          row_sort: "unit_id asc, tenant_name asc (nulls last), id",
          totals_rows: ["TOTAL_OCCUPIED", "TOTAL_VACANT", "TOTALS"],
        },
      };
    },
  };
}
