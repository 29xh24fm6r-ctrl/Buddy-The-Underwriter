import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export type CommitteeActivationRow = {
  id: string;
  name: string;
  borrower: string;
  stage: string;
  amountLabel: string;
  riskLabel: string;
  updatedAt: string;
  searchText: string;
};

export type CommitteeActivationData = {
  rows: CommitteeActivationRow[];
  totals: { count: number; pendingCount: number };
  error?: string;
};

function formatMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export async function getCreditCommitteeViewActivationData(
  limit = 50
): Promise<CommitteeActivationData> {
  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("deals")
      .select("id, display_name, nickname, borrower_name, name, amount, stage, risk_score, updated_at")
      .eq("bank_id", bankId)
      .in("stage", ["committee_ready", "approved", "underwrite_in_progress"])
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[creditCommitteeView activation] query failed:", error);
      return { rows: [], totals: { count: 0, pendingCount: 0 } };
    }

    const rows: CommitteeActivationRow[] = (data ?? []).map((d: any) => {
      const name = String(d.display_name || d.nickname || d.borrower_name || d.name || "Untitled Deal");
      const borrower = String(d.borrower_name || d.name || "-");
      const amount = typeof d.amount === "number" ? d.amount : Number(d.amount);
      return {
        id: String(d.id),
        name,
        borrower,
        stage: String(d.stage || "-"),
        amountLabel: formatMoney(amount),
        riskLabel: d.risk_score != null ? String(d.risk_score) : "-",
        updatedAt: String(d.updated_at || ""),
        searchText: [name, borrower, d.stage].join(" ").toLowerCase(),
      };
    });

    const pendingCount = rows.filter((r) => r.stage === "committee_ready").length;

    return { rows, totals: { count: rows.length, pendingCount } };
  } catch (err) {
    console.error("[creditCommitteeView activation] error:", err);
    return { rows: [], totals: { count: 0, pendingCount: 0 }, error: String(err) };
  }
}

export function serializeCreditCommitteeViewData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildCreditCommitteeViewActivationScript(): string {
  return `
(function () {
  function getData() {
    var el = document.getElementById("__stitch_activation_data__");
    if (!el) return null;
    try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
  }

  function formatRelative(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    var diffMs = Date.now() - d.getTime();
    var diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return diffSec + "s ago";
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + "m ago";
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + "h ago";
    return Math.floor(diffHr / 24) + "d ago";
  }

  function updateRow(row, deal) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 4) return;
    var nameEl = cells[0].querySelector("span") || cells[0];
    nameEl.textContent = deal.name;
    nameEl.setAttribute("data-activated", "true");
    var sub = cells[0].querySelector("span.text-xs");
    if (sub) { sub.textContent = deal.borrower + " • " + deal.stage; sub.setAttribute("data-activated", "true"); }
    if (cells[1]) cells[1].textContent = deal.amountLabel || "-";
    if (cells[2]) cells[2].textContent = deal.riskLabel || "-";
    if (cells[3]) cells[3].textContent = formatRelative(deal.updatedAt);
    row.setAttribute("data-activated", "true");
  }

  function renderRows(rows) {
    var tbody = document.querySelector("table tbody");
    if (!tbody) return;
    var tpl = tbody.querySelector("tr");
    if (!tpl) return;
    tbody.innerHTML = "";
    rows.forEach(function (deal) {
      var row = tpl.cloneNode(true);
      updateRow(row, deal);
      row.style.cursor = "pointer";
      row.addEventListener("click", function () {
        var origin = window.__STITCH_PARENT_ORIGIN || "";
        try { parent.postMessage({ __stitchFrame: true, type: "navigate", href: "/deals/" + deal.id + "/committee" }, origin); } catch (e) {}
      });
      tbody.appendChild(row);
    });
    if (!rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 8;
      td.className = "px-4 py-6 text-center text-sm opacity-60";
      td.textContent = "No deals pending committee review.";
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
  }

  var data = getData();
  if (!data || !data.rows) return;
  renderRows(data.rows);

  // Update KPI counts if visible
  var nodes = document.querySelectorAll("span.text-xl, span.text-2xl, span.text-3xl");
  for (var i = 0; i < nodes.length; i++) {
    var text = (nodes[i].previousElementSibling || {}).textContent || "";
    if (text.toLowerCase().includes("pending")) { nodes[i].textContent = String(data.totals.pendingCount || 0); nodes[i].setAttribute("data-activated", "true"); }
    if (text.toLowerCase().includes("total") || text.toLowerCase().includes("queue")) { nodes[i].textContent = String(data.totals.count || 0); nodes[i].setAttribute("data-activated", "true"); }
  }
})();
`;
}
