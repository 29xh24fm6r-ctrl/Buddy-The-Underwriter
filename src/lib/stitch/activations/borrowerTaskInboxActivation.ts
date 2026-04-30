import { supabaseAdmin } from "@/lib/supabase/admin";

export type TaskInboxRow = {
  key: string;
  label: string;
  status: string;
  required: boolean;
};

export type TaskInboxActivationData = {
  dealId: string;
  items: TaskInboxRow[];
  totals: { required: number; received: number; missing: number };
  error?: string;
};

export async function getBorrowerTaskInboxActivationData(
  dealId: string | null,
  limit = 50
): Promise<TaskInboxActivationData> {
  if (!dealId) return { dealId: "", items: [], totals: { required: 0, received: 0, missing: 0 } };

  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("deal_checklist_items")
      .select("checklist_key, label, status, required")
      .eq("deal_id", dealId)
      .order("required", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[borrowerTaskInbox activation] query failed:", error);
      return { dealId, items: [], totals: { required: 0, received: 0, missing: 0 } };
    }

    const items: TaskInboxRow[] = (data ?? []).map((d: any) => ({
      key: String(d.checklist_key || ""),
      label: String(d.label || d.checklist_key || "Unknown"),
      status: String(d.status || "missing"),
      required: Boolean(d.required),
    }));

    const required = items.filter((i) => i.required).length;
    const received = items.filter((i) => i.status === "received" || i.status === "satisfied").length;

    return {
      dealId,
      items,
      totals: { required, received, missing: Math.max(0, required - received) },
    };
  } catch (err) {
    console.error("[borrowerTaskInbox activation] error:", err);
    return { dealId: dealId || "", items: [], totals: { required: 0, received: 0, missing: 0 }, error: String(err) };
  }
}

export function serializeTaskInboxData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildBorrowerTaskInboxActivationScript(): string {
  return `
(function () {
  function getData() {
    var el = document.getElementById("__stitch_activation_data__");
    if (!el) return null;
    try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
  }

  function updateRow(row, item) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 2) return;
    var nameEl = cells[0].querySelector("span") || cells[0];
    nameEl.textContent = item.label;
    nameEl.setAttribute("data-activated", "true");
    if (cells[1]) {
      var badge = cells[1].querySelector("span") || cells[1];
      badge.textContent = item.status;
      badge.setAttribute("data-activated", "true");
    }
    if (cells[2]) cells[2].textContent = item.required ? "Required" : "Optional";
    row.setAttribute("data-activated", "true");
  }

  function renderRows(items) {
    var tbody = document.querySelector("table tbody");
    if (!tbody) return;
    var tpl = tbody.querySelector("tr");
    if (!tpl) return;
    tbody.innerHTML = "";
    items.forEach(function (item) {
      var row = tpl.cloneNode(true);
      updateRow(row, item);
      tbody.appendChild(row);
    });
    if (!items.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 6;
      td.className = "px-4 py-6 text-center text-sm opacity-60";
      td.textContent = "No checklist items for this deal.";
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
  }

  function addActionCell(row, item) {
    var td = document.createElement("td");
    td.className = "px-3 py-2";
    if (item.status === "received" || item.status === "satisfied") {
      var badge = document.createElement("span");
      badge.className = "px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700";
      badge.textContent = "Resolved";
      td.appendChild(badge);
    } else {
      var btn = document.createElement("button");
      btn.className = "px-2 py-1 text-[11px] font-semibold rounded bg-blue-600 text-white hover:bg-blue-700";
      btn.textContent = "Mark Received";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = "...";
        var origin = window.__STITCH_PARENT_ORIGIN || window.location.origin || "";
        fetch(origin + "/api/deals/" + data.dealId + "/checklist/set-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ checklistKey: item.key, status: "received" }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) {
              btn.textContent = "Received";
              btn.className = "px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700";
              btn.disabled = true;
            } else {
              btn.textContent = res.error || "Error";
              btn.disabled = false;
            }
          })
          .catch(function () { btn.textContent = "Error"; btn.disabled = false; });
      });
      td.appendChild(btn);
    }
    row.appendChild(td);
  }

  var data = getData();
  if (!data || !data.items) return;

  var thead = document.querySelector("table thead tr");
  if (thead) {
    var th = document.createElement("th");
    th.className = "px-3 py-2 text-xs font-medium";
    th.textContent = "Actions";
    thead.appendChild(th);
  }

  var tbody = document.querySelector("table tbody");
  if (tbody) {
    var tpl = tbody.querySelector("tr");
    if (tpl) {
      tbody.innerHTML = "";
      data.items.forEach(function (item) {
        var row = tpl.cloneNode(true);
        updateRow(row, item);
        addActionCell(row, item);
        tbody.appendChild(row);
      });
      if (!data.items.length) {
        var empty = document.createElement("tr");
        var etd = document.createElement("td");
        etd.colSpan = 7;
        etd.className = "px-4 py-6 text-center text-sm opacity-60";
        etd.textContent = "No checklist items for this deal.";
        empty.appendChild(etd);
        tbody.appendChild(empty);
      }
    }
  }

  var nodes = document.querySelectorAll("span.text-xl, span.text-2xl, span.text-3xl");
  for (var i = 0; i < nodes.length; i++) {
    var text = (nodes[i].previousElementSibling || {}).textContent || "";
    if (text.toLowerCase().includes("required")) { nodes[i].textContent = String(data.totals.required || 0); nodes[i].setAttribute("data-activated", "true"); }
    if (text.toLowerCase().includes("received")) { nodes[i].textContent = String(data.totals.received || 0); nodes[i].setAttribute("data-activated", "true"); }
    if (text.toLowerCase().includes("missing")) { nodes[i].textContent = String(data.totals.missing || 0); nodes[i].setAttribute("data-activated", "true"); }
  }
})();
`;
}
