import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export type ExceptionActivationRow = {
  id: string;
  dealName: string;
  borrower: string;
  stage: string;
  exceptionCount: number;
  severity: string;
  updatedAt: string;
  searchText: string;
};

export type ExceptionActivationData = {
  rows: ExceptionActivationRow[];
  totals: { count: number; criticalCount: number };
  error?: string;
};

export async function getExceptionsChangeReviewActivationData(
  limit = 50
): Promise<ExceptionActivationData> {
  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Get deals that have policy exceptions
    const { data: exceptions } = await sb
      .from("deal_policy_exceptions")
      .select("deal_id, severity, status")
      .eq("bank_id", bankId)
      .in("status", ["open", "pending_review", "escalated"])
      .limit(200);

    // Group by deal
    const dealExceptions = new Map<string, { count: number; hasCritical: boolean }>();
    for (const ex of exceptions ?? []) {
      const existing = dealExceptions.get(ex.deal_id) ?? { count: 0, hasCritical: false };
      existing.count++;
      if (ex.severity === "critical" || ex.severity === "high") existing.hasCritical = true;
      dealExceptions.set(ex.deal_id, existing);
    }

    const dealIds = Array.from(dealExceptions.keys());
    if (dealIds.length === 0) {
      // Fallback: show deals with risk flags
      const { data: deals } = await sb
        .from("deals")
        .select("id, display_name, nickname, borrower_name, name, stage, risk_score, updated_at")
        .eq("bank_id", bankId)
        .not("risk_score", "is", null)
        .order("updated_at", { ascending: false })
        .limit(limit);

      const rows: ExceptionActivationRow[] = (deals ?? []).map((d: any) => {
        const name = String(d.display_name || d.nickname || d.borrower_name || d.name || "Untitled Deal");
        const borrower = String(d.borrower_name || d.name || "-");
        return {
          id: String(d.id),
          dealName: name,
          borrower,
          stage: String(d.stage || "-"),
          exceptionCount: 0,
          severity: d.risk_score != null && d.risk_score > 70 ? "high" : "normal",
          updatedAt: String(d.updated_at || ""),
          searchText: [name, borrower].join(" ").toLowerCase(),
        };
      });

      return { rows, totals: { count: rows.length, criticalCount: 0 } };
    }

    // Fetch deal details
    const { data: deals } = await sb
      .from("deals")
      .select("id, display_name, nickname, borrower_name, name, stage, updated_at")
      .in("id", dealIds.slice(0, limit));

    const rows: ExceptionActivationRow[] = (deals ?? []).map((d: any) => {
      const name = String(d.display_name || d.nickname || d.borrower_name || d.name || "Untitled Deal");
      const borrower = String(d.borrower_name || d.name || "-");
      const ex = dealExceptions.get(String(d.id));
      return {
        id: String(d.id),
        dealName: name,
        borrower,
        stage: String(d.stage || "-"),
        exceptionCount: ex?.count ?? 0,
        severity: ex?.hasCritical ? "critical" : "normal",
        updatedAt: String(d.updated_at || ""),
        searchText: [name, borrower].join(" ").toLowerCase(),
      };
    });

    rows.sort((a, b) => b.exceptionCount - a.exceptionCount);
    const criticalCount = rows.filter((r) => r.severity === "critical").length;

    return { rows, totals: { count: rows.length, criticalCount } };
  } catch (err) {
    console.error("[exceptionsChangeReview activation] error:", err);
    return { rows: [], totals: { count: 0, criticalCount: 0 }, error: String(err) };
  }
}

export function serializeExceptionsData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildExceptionsChangeReviewActivationScript(): string {
  return `
(function () {
  function getData() {
    var el = document.getElementById("__stitch_activation_data__");
    if (!el) return null;
    try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
  }

  function updateRow(row, item) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 3) return;
    var nameEl = cells[0].querySelector("span") || cells[0];
    nameEl.textContent = item.dealName;
    nameEl.setAttribute("data-activated", "true");
    var sub = cells[0].querySelector("span.text-xs");
    if (sub) { sub.textContent = item.borrower + " • " + item.stage; sub.setAttribute("data-activated", "true"); }
    if (cells[1]) { cells[1].textContent = item.exceptionCount > 0 ? item.exceptionCount + " exception(s)" : "Risk flagged"; }
    if (cells[2]) {
      var badge = cells[2].querySelector("span") || cells[2];
      badge.textContent = item.severity === "critical" ? "Critical" : "Normal";
      badge.setAttribute("data-activated", "true");
    }
    row.setAttribute("data-activated", "true");
  }

  function renderRows(rows) {
    var tbody = document.querySelector("table tbody");
    if (!tbody) return;
    var tpl = tbody.querySelector("tr");
    if (!tpl) return;
    tbody.innerHTML = "";
    rows.forEach(function (item) {
      var row = tpl.cloneNode(true);
      updateRow(row, item);
      row.style.cursor = "pointer";
      row.addEventListener("click", function () {
        var origin = window.__STITCH_PARENT_ORIGIN || "";
        try { parent.postMessage({ __stitchFrame: true, type: "navigate", href: "/deals/" + item.id + "/risk" }, origin); } catch (e) {}
      });
      tbody.appendChild(row);
    });
    if (!rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 8;
      td.className = "px-4 py-6 text-center text-sm opacity-60";
      td.textContent = "No active exceptions.";
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
  }

  var data = getData();
  if (!data || !data.rows) return;
  renderRows(data.rows);

  var nodes = document.querySelectorAll("span.text-xl, span.text-2xl, span.text-3xl");
  for (var i = 0; i < nodes.length; i++) {
    var text = (nodes[i].previousElementSibling || {}).textContent || "";
    if (text.toLowerCase().includes("critical")) { nodes[i].textContent = String(data.totals.criticalCount || 0); nodes[i].setAttribute("data-activated", "true"); }
    if (text.toLowerCase().includes("total") || text.toLowerCase().includes("active") || text.toLowerCase().includes("open")) { nodes[i].textContent = String(data.totals.count || 0); nodes[i].setAttribute("data-activated", "true"); }
  }
})();
`;
}
