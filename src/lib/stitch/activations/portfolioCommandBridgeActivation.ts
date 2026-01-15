import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export type PortfolioActivationRow = {
  id: string;
  name: string;
  borrower: string;
  stage: string;
  upbLabel?: string;
  rateLabel?: string;
  profitLabel?: string;
  dscrLabel?: string;
  ltvLabel?: string;
  ioLabel?: string;
  flags: string[];
  updatedAt?: string;
  searchText: string;
};

export type PortfolioActivationData = {
  rows: PortfolioActivationRow[];
  totals: {
    exposure: number;
    count: number;
    exposureLabel?: string;
    watchlistCount?: number;
  };
};

const DEFAULT_LIMIT = 200;

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(amount);
}

function formatMoneyShort(amount: number): string | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount.toFixed(0)}`;
}

function formatRelative(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export async function getPortfolioCommandBridgeActivationData(
  limit = DEFAULT_LIMIT
): Promise<PortfolioActivationData> {
  let bankId: string;
  let sb: ReturnType<typeof supabaseAdmin>;

  try {
    bankId = await getCurrentBankId();
    sb = supabaseAdmin();
  } catch (error) {
    console.error("[/portfolio activation] missing auth/env:", error);
    return { rows: [], totals: { exposure: 0, count: 0 } };
  }

  const selectPrimary =
    "id, borrower_name, name, stage, status, amount, loan_amount, updated_at, created_at";

  const { data, error } = await sb
    .from("deals")
    .select(selectPrimary)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[/portfolio activation] deals_select_failed:", error);
  }

  const deals = (data ?? []) as Array<Record<string, unknown>>;
  const rows: PortfolioActivationRow[] = [];
  let exposure = 0;

  for (const deal of deals) {
    const amountRaw = deal.loan_amount ?? deal.amount;
    const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
    if (Number.isFinite(amount)) {
      exposure += amount;
    }

    const name = String(deal.name ?? deal.borrower_name ?? "Untitled Deal").trim() || "Untitled Deal";
    const borrower = String(deal.borrower_name ?? deal.name ?? "-").trim() || "-";
    const stage = String(deal.stage ?? "-").trim() || "-";
    const updatedAt = String(deal.updated_at ?? deal.created_at ?? "");

    const searchText = [name, borrower, stage].join(" ").toLowerCase();

    rows.push({
      id: String(deal.id ?? ""),
      name,
      borrower,
      stage,
      upbLabel: formatMoneyShort(Number.isFinite(amount) ? amount : 0),
      rateLabel: "-",
      profitLabel: "-",
      dscrLabel: "-",
      ltvLabel: "-",
      ioLabel: "-",
      flags: [],
      updatedAt,
      searchText,
    });
  }

  return {
    rows,
    totals: {
      exposure,
      count: rows.length,
      exposureLabel: exposure ? formatMoney(exposure) : undefined,
      watchlistCount: 0,
    },
  };
}

export function serializeActivationData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildPortfolioCommandBridgeActivationScript(): string {
  return `
(function () {
  function getData() {
    var el = document.getElementById("__stitch_activation_data__");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (e) {
      return null;
    }
  }

  function formatRelative(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    var diffMs = Date.now() - d.getTime();
    var diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return diffSec + "s ago";
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + "m ago";
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + "h ago";
    var diffDay = Math.floor(diffHr / 24);
    return diffDay + "d ago";
  }

  function setKpi(label, valueText) {
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll("section .text-text-secondary")
    );
    var match = nodes.find(function (n) {
      return n.textContent && n.textContent.trim().toLowerCase() === label;
    });
    if (!match) return;
    var container = match.closest("div");
    if (!container) return;
    var value = container.querySelector("span.text-xl");
    if (value && valueText) {
      value.textContent = valueText;
      container.setAttribute("data-activated", "true");
    }
  }

  function updateKpis(data) {
    if (!data || !data.totals) return;
    if (data.totals.exposureLabel) {
      setKpi("total exposure", data.totals.exposureLabel);
    }
    if (data.totals.count != null) {
      setKpi("watchlist", String(data.totals.watchlistCount || 0));
    }
  }

  function updateRow(row, deal) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 9) return;

    var nameCell = cells[0];
    var namePrimary = nameCell.querySelector("span");
    if (namePrimary) {
      namePrimary.textContent = deal.name || "Untitled Deal";
      namePrimary.setAttribute("data-activated", "true");
    }
    var nameSecondary = nameCell.querySelector("span.text-xs");
    if (nameSecondary) {
      var secondary = deal.borrower ? deal.borrower + " • " + (deal.stage || "-") : (deal.stage || "-");
      nameSecondary.textContent = secondary;
      nameSecondary.setAttribute("data-activated", "true");
    }

    cells[1].textContent = deal.upbLabel || "-";
    cells[2].textContent = deal.rateLabel || "-";
    cells[3].textContent = deal.profitLabel || "-";
    cells[4].textContent = deal.dscrLabel || "-";
    cells[5].textContent = deal.ltvLabel || "-";

    var ioCell = cells[6];
    var ioBadge = ioCell.querySelector("span");
    if (ioBadge) {
      ioBadge.textContent = deal.ioLabel || "-";
      ioBadge.setAttribute("data-activated", "true");
    } else {
      ioCell.textContent = deal.ioLabel || "-";
    }

    var flagsCell = cells[7];
    flagsCell.innerHTML = "";
    if (deal.flags && deal.flags.length) {
      var wrap = document.createElement("div");
      wrap.className = "flex flex-wrap gap-1.5";
      deal.flags.forEach(function (flag) {
        var span = document.createElement("span");
        span.className = "px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-dark text-text-secondary border border-border-dark uppercase tracking-wide";
        span.textContent = flag;
        wrap.appendChild(span);
      });
      flagsCell.appendChild(wrap);
    } else {
      var clean = document.createElement("span");
      clean.className = "px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-dark text-text-secondary border border-border-dark uppercase tracking-wide";
      clean.textContent = "Clean";
      flagsCell.appendChild(clean);
    }

    cells[8].textContent = formatRelative(deal.updatedAt);

    row.setAttribute("data-activated", "true");
  }

  function bindRowNavigation(row, dealId) {
    if (!dealId) return;
    row.addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.closest && target.closest("a,button")) return;
      var origin = window.__STITCH_PARENT_ORIGIN || "";
      try {
        parent.postMessage({ __stitchFrame: true, type: "navigate", href: "/deals/" + dealId + "/command" }, origin);
      } catch (e) {}
    });
  }

  function renderRows(rows) {
    var tbody = document.querySelector("table tbody");
    if (!tbody) return;
    var template = tbody.querySelector("tr");
    if (!template) return;
    tbody.innerHTML = "";

    rows.forEach(function (deal) {
      var row = template.cloneNode(true);
      updateRow(row, deal);
      bindRowNavigation(row, deal.id);
      tbody.appendChild(row);
    });

    if (!rows.length) {
      var emptyRow = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 9;
      td.className = "px-4 py-6 text-text-secondary text-sm";
      td.textContent = "No active loans found.";
      emptyRow.appendChild(td);
      tbody.appendChild(emptyRow);
    }
  }

  function bindSearch(rows) {
    var input = document.querySelector("header input");
    if (!input) return;
    input.addEventListener("input", function (event) {
      var value = (event.target && event.target.value ? event.target.value : "").toLowerCase();
      var filtered = rows.filter(function (deal) {
        return !value || (deal.searchText || "").includes(value);
      });
      renderRows(filtered);
    });
  }

  var data = getData();
  if (!data || !data.rows) return;

  updateKpis(data);
  renderRows(data.rows);
  bindSearch(data.rows);
})();
`;
}
