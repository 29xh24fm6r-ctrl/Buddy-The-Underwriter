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

export type ExceptionHistoryEntry = {
  actionLabel: string;
  actor: string;
  occurredAt: string;
  rationale?: string;
};

export type ExceptionActivationData = {
  rows: ExceptionActivationRow[];
  totals: { count: number; criticalCount: number };
  history: ExceptionHistoryEntry[];
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

    // Fetch recent exception decision events
    const { data: events } = await sb
      .from("deal_events")
      .select("kind, payload, created_at")
      .in("kind", ["exception.decision.approve", "exception.decision.reject", "exception.decision.escalate"])
      .order("created_at", { ascending: false })
      .limit(5);

    const history: ExceptionHistoryEntry[] = (events ?? []).map((e: any) => {
      const payload = typeof e.payload === "object" ? e.payload : {};
      return {
        actionLabel: e.kind?.replace("exception.decision.", "") ?? "unknown",
        actor: payload?.actor_user_id ?? payload?.meta?.actor_user_id ?? "system",
        occurredAt: e.created_at ?? "",
        rationale: payload?.meta?.rationale ?? null,
      };
    });

    return { rows, totals: { count: rows.length, criticalCount }, history };
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

  function addActionCell(row, item) {
    var td = document.createElement("td");
    td.className = "px-3 py-2 flex gap-1";
    function mkBtn(label, cls, action) {
      var btn = document.createElement("button");
      btn.className = "px-2 py-1 text-[11px] font-semibold rounded " + cls;
      btn.textContent = label;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = "...";
        var origin = window.__STITCH_PARENT_ORIGIN || window.location.origin || "";
        fetch(origin + "/api/exceptions/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ exceptionId: item.id, action: action, dealId: item.id, rationale: "Decision from exceptions surface" }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) {
              btn.textContent = action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Escalated";
              btn.className = "px-2 py-1 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800";
              row.style.opacity = "0.6";
            } else {
              btn.textContent = res.error || "Error";
              btn.disabled = false;
            }
          })
          .catch(function () { btn.textContent = "Error"; btn.disabled = false; });
      });
      return btn;
    }
    td.appendChild(mkBtn("Approve", "bg-emerald-600 text-white hover:bg-emerald-700", "approve"));
    td.appendChild(mkBtn("Reject", "bg-red-100 text-red-700 hover:bg-red-200", "reject"));
    td.appendChild(mkBtn("Escalate", "bg-amber-100 text-amber-700 hover:bg-amber-200", "escalate"));
    row.appendChild(td);
  }

  var data = getData();
  if (!data || !data.rows) return;

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
      data.rows.forEach(function (item) {
        var row = tpl.cloneNode(true);
        updateRow(row, item);
        addActionCell(row, item);
        row.style.cursor = "pointer";
        row.addEventListener("click", function () {
          var origin = window.__STITCH_PARENT_ORIGIN || "";
          try { parent.postMessage({ __stitchFrame: true, type: "navigate", href: "/deals/" + item.id + "/risk" }, origin); } catch (e) {}
        });
        tbody.appendChild(row);
      });
      if (!data.rows.length) {
        var empty = document.createElement("tr");
        var etd = document.createElement("td");
        etd.colSpan = 9;
        etd.className = "px-4 py-6 text-center text-sm opacity-60";
        etd.textContent = "No active exceptions.";
        empty.appendChild(etd);
        tbody.appendChild(empty);
      }
    }
  }

  // Render history panel
  if (data.history && data.history.length > 0) {
    var histPanel = document.createElement("div");
    histPanel.className = "mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4";
    histPanel.setAttribute("data-activated", "true");
    var histTitle = document.createElement("div");
    histTitle.className = "text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2";
    histTitle.textContent = "Recent Exception Decisions";
    histPanel.appendChild(histTitle);
    data.history.forEach(function (h) {
      var row = document.createElement("div");
      row.className = "flex items-center gap-2 py-1 text-xs";
      var badge = document.createElement("span");
      badge.className = "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase " +
        (h.actionLabel === "approve" ? "bg-emerald-100 text-emerald-700" :
         h.actionLabel === "reject" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700");
      badge.textContent = h.actionLabel;
      row.appendChild(badge);
      var actor = document.createElement("span");
      actor.className = "text-neutral-600";
      actor.textContent = "by " + h.actor;
      row.appendChild(actor);
      var time = document.createElement("span");
      time.className = "text-neutral-400 ml-auto";
      time.textContent = h.occurredAt ? new Date(h.occurredAt).toLocaleDateString() : "";
      row.appendChild(time);
      histPanel.appendChild(row);
    });
    var tbl = document.querySelector("table");
    if (tbl && tbl.parentNode) { tbl.parentNode.insertBefore(histPanel, tbl); }
  }

  var nodes = document.querySelectorAll("span.text-xl, span.text-2xl, span.text-3xl");
  for (var i = 0; i < nodes.length; i++) {
    var text = (nodes[i].previousElementSibling || {}).textContent || "";
    if (text.toLowerCase().includes("critical")) { nodes[i].textContent = String(data.totals.criticalCount || 0); nodes[i].setAttribute("data-activated", "true"); }
    if (text.toLowerCase().includes("total") || text.toLowerCase().includes("active") || text.toLowerCase().includes("open")) { nodes[i].textContent = String(data.totals.count || 0); nodes[i].setAttribute("data-activated", "true"); }
  }
})();
`;
}
