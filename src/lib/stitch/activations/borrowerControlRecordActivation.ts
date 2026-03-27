import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export type BorrowerControlRow = {
  dealId: string;
  borrowerName: string;
  legalName: string;
  dealName: string;
  stage: string;
  entityType: string;
  updatedAt: string;
  searchText: string;
};

export type BorrowerControlActivationData = {
  rows: BorrowerControlRow[];
  totals: { count: number };
  error?: string;
};

export async function getBorrowerControlRecordActivationData(
  limit = 50
): Promise<BorrowerControlActivationData> {
  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("deals")
      .select("id, display_name, nickname, borrower_name, name, legal_name, stage, updated_at")
      .eq("bank_id", bankId)
      .not("borrower_name", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[borrowerControlRecord activation] query failed:", error);
      return { rows: [], totals: { count: 0 } };
    }

    const seen = new Set<string>();
    const rows: BorrowerControlRow[] = [];

    for (const d of data ?? []) {
      const borrowerName = String(d.borrower_name || "").trim();
      if (!borrowerName || seen.has(borrowerName.toLowerCase())) continue;
      seen.add(borrowerName.toLowerCase());

      const dealName = String((d as any).display_name || (d as any).nickname || d.name || "Untitled Deal");
      rows.push({
        dealId: String(d.id),
        borrowerName,
        legalName: String((d as any).legal_name || borrowerName),
        dealName,
        stage: String(d.stage || "-"),
        entityType: "Borrower",
        updatedAt: String(d.updated_at || ""),
        searchText: [borrowerName, dealName].join(" ").toLowerCase(),
      });
    }

    return { rows, totals: { count: rows.length } };
  } catch (err) {
    console.error("[borrowerControlRecord activation] error:", err);
    return { rows: [], totals: { count: 0 }, error: String(err) };
  }
}

export function serializeBorrowerControlData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildBorrowerControlRecordActivationScript(): string {
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
    nameEl.textContent = item.borrowerName;
    nameEl.setAttribute("data-activated", "true");
    var sub = cells[0].querySelector("span.text-xs");
    if (sub) { sub.textContent = item.legalName; sub.setAttribute("data-activated", "true"); }
    if (cells[1]) cells[1].textContent = item.dealName + " • " + item.stage;
    if (cells[2]) cells[2].textContent = item.entityType;
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
        try { parent.postMessage({ __stitchFrame: true, type: "navigate", href: "/deals/" + item.dealId + "/borrower" }, origin); } catch (e) {}
      });
      tbody.appendChild(row);
    });
    if (!rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 6;
      td.className = "px-4 py-6 text-center text-sm opacity-60";
      td.textContent = "No borrower records found.";
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
    if (text.toLowerCase().includes("total") || text.toLowerCase().includes("borrower")) { nodes[i].textContent = String(data.totals.count || 0); nodes[i].setAttribute("data-activated", "true"); }
  }
})();
`;
}
