import { supabaseAdmin } from "@/lib/supabase/admin";

export type PricingScenarioRow = {
  key: string;
  label: string;
  dscr: string;
  ltv: string;
  debtYield: string;
  rate: string;
  monthlyPayment: string;
};

export type PricingMemoActivationData = {
  dealId: string;
  dealName: string;
  borrower: string;
  scenarios: PricingScenarioRow[];
  decision: { recommendation: string; rationale: string } | null;
  error?: string;
};

function fmt(n: unknown, suffix = ""): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(2) + suffix;
}

function fmtPct(n: unknown): string { return fmt(n, "%"); }

function fmtMoney(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export async function getPricingMemoActivationData(
  dealId: string | null
): Promise<PricingMemoActivationData> {
  if (!dealId) return { dealId: "", dealName: "", borrower: "", scenarios: [], decision: null };

  try {
    const sb = supabaseAdmin();

    const [dealRes, scenarioRes, decisionRes] = await Promise.all([
      sb.from("deals").select("display_name, nickname, borrower_name, name").eq("id", dealId).maybeSingle(),
      sb.from("pricing_scenarios").select("*").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(10),
      sb.from("pricing_decisions").select("recommendation, rationale").eq("deal_id", dealId).maybeSingle(),
    ]);

    const deal = dealRes.data as any;
    const dealName = String(deal?.display_name || deal?.nickname || deal?.borrower_name || deal?.name || "");
    const borrower = String(deal?.borrower_name || deal?.name || "");

    const scenarios: PricingScenarioRow[] = ((scenarioRes.data ?? []) as any[]).map((s) => ({
      key: String(s.scenario_key || ""),
      label: String(s.scenario_key || "").replace(/_/g, " "),
      dscr: fmt(s.dscr),
      ltv: fmtPct(s.ltv),
      debtYield: fmtPct(s.debt_yield),
      rate: fmtPct(s.rate_pct ?? s.note_rate),
      monthlyPayment: fmtMoney(s.monthly_payment ?? s.monthly_pi),
    }));

    const dec = decisionRes.data as any;
    const decision = dec ? { recommendation: String(dec.recommendation || ""), rationale: String(dec.rationale || "") } : null;

    return { dealId, dealName, borrower, scenarios, decision };
  } catch (err) {
    console.error("[pricingMemo activation] error:", err);
    return { dealId: dealId || "", dealName: "", borrower: "", scenarios: [], decision: null, error: String(err) };
  }
}

export function serializePricingMemoData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildPricingMemoActivationScript(): string {
  return `
(function () {
  function getData() {
    var el = document.getElementById("__stitch_activation_data__");
    if (!el) return null;
    try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
  }

  function updateRow(row, scenario) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 4) return;
    var nameEl = cells[0].querySelector("span") || cells[0];
    nameEl.textContent = scenario.label;
    nameEl.setAttribute("data-activated", "true");
    if (cells[1]) cells[1].textContent = "DSCR " + scenario.dscr + " | LTV " + scenario.ltv;
    if (cells[2]) cells[2].textContent = scenario.rate;
    if (cells[3]) cells[3].textContent = scenario.monthlyPayment;
    row.setAttribute("data-activated", "true");
  }

  function renderRows(scenarios) {
    var tbody = document.querySelector("table tbody");
    if (!tbody) return;
    var tpl = tbody.querySelector("tr");
    if (!tpl) return;
    tbody.innerHTML = "";
    scenarios.forEach(function (s) {
      var row = tpl.cloneNode(true);
      updateRow(row, s);
      tbody.appendChild(row);
    });
    if (!scenarios.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 8;
      td.className = "px-4 py-6 text-center text-sm opacity-60";
      td.textContent = "No pricing scenarios generated yet.";
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
  }

  var data = getData();
  if (!data) return;

  // Update deal header
  var titleEl = document.querySelector("h1, h2, [class*='text-2xl'], [class*='text-xl']");
  if (titleEl && data.dealName) { titleEl.textContent = data.dealName; titleEl.setAttribute("data-activated", "true"); }

  if (data.scenarios) renderRows(data.scenarios);

  // Update decision section
  if (data.decision) {
    var recEls = document.querySelectorAll("[class*='font-bold'], [class*='font-semibold']");
    for (var i = 0; i < recEls.length; i++) {
      var t = recEls[i].textContent || "";
      if (t.toLowerCase().includes("recommend") || t.toLowerCase().includes("decision")) {
        var next = recEls[i].nextElementSibling;
        if (next) { next.textContent = data.decision.recommendation + " — " + data.decision.rationale; next.setAttribute("data-activated", "true"); }
        break;
      }
    }
  }

  // Inject commit action bar
  if (data.dealId && data.scenarios && data.scenarios.length > 0) {
    var container = document.querySelector("table") || document.querySelector("main") || document.body;
    var bar = document.createElement("div");
    bar.className = "flex items-center gap-3 mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50";
    bar.setAttribute("data-activated", "true");

    var label = document.createElement("span");
    label.className = "text-sm font-medium text-blue-900";
    label.textContent = data.decision ? "Decision: " + data.decision.recommendation : "No decision recorded yet";
    bar.appendChild(label);

    if (!data.decision) {
      var commitBtn = document.createElement("button");
      commitBtn.className = "ml-auto px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700";
      commitBtn.textContent = "Commit Pricing";
      commitBtn.addEventListener("click", function () {
        commitBtn.disabled = true;
        commitBtn.textContent = "Committing...";
        var origin = window.__STITCH_PARENT_ORIGIN || window.location.origin || "";
        var firstScenario = data.scenarios[0];
        fetch(origin + "/api/deals/" + data.dealId + "/pricing/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scenarioKey: firstScenario.key, decision: "APPROVED", rationale: "Committed from pricing memo surface" }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) {
              commitBtn.textContent = "Committed";
              commitBtn.className = "ml-auto px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white";
              label.textContent = "Decision: APPROVED";
            } else {
              commitBtn.textContent = res.error || "Error";
              commitBtn.disabled = false;
            }
          })
          .catch(function () { commitBtn.textContent = "Error"; commitBtn.disabled = false; });
      });
      bar.appendChild(commitBtn);
    }

    container.parentNode.insertBefore(bar, container.nextSibling);
  }
})();
`;
}
