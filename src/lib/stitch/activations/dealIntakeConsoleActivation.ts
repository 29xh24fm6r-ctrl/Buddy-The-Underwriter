import { listDealsForBank } from "@/lib/deals/listDeals";

export type DealIntakeActivationRow = {
  id: string;
  name: string;
  borrower: string;
  stage: string;
  amountLabel?: string;
  createdLabel?: string;
};

export type DealIntakeActivationData = {
  rows: DealIntakeActivationRow[];
  error?: string;
};

const DEFAULT_LIMIT = 25;

function pickIntakeDeals(rows: DealIntakeActivationRow[]): DealIntakeActivationRow[] {
  const intakeRows = rows.filter((row) => row.stage.toLowerCase().includes("intake"));
  return intakeRows.length ? intakeRows : rows;
}

export async function getDealIntakeConsoleActivationData(
  limit = DEFAULT_LIMIT
): Promise<DealIntakeActivationData> {
  try {
    const deals = await listDealsForBank(limit);
    const rows = deals.map((deal) => ({
      id: deal.id,
      name: deal.name || "Untitled Deal",
      borrower: deal.borrower || "-",
      stage: deal.stageLabel || deal.stage || "-",
      amountLabel: deal.amountLabel || "-",
      createdLabel: deal.createdLabel || "-",
    }));

    return { rows: pickIntakeDeals(rows).slice(0, limit) };
  } catch (error) {
    console.error("[/intake activation] deals_load_failed:", error);
    return { rows: [], error: "Failed to load deals" };
  }
}

export function serializeActivationData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildDealIntakeConsoleActivationScript(): string {
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

  function findQueueTbody(root) {
    if (!root) return null;
    var main = root.querySelector("main") || root;
    var tables = Array.prototype.slice.call(main.querySelectorAll("table"));
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var headerCells = table.querySelectorAll("thead th");
      var row = table.querySelector("tbody tr");
      var cells = row ? row.querySelectorAll("td") : [];
      if (headerCells.length >= 4 && cells.length >= 4) {
        var tbody = table.querySelector("tbody");
        if (tbody) return tbody;
      }
    }
    return null;
  }

  function setCellText(cell, text) {
    if (!cell) return;
    cell.textContent = text;
  }

  function updateRow(row, deal) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 4) return;

    var nameCell = cells[0];
    var nameText = nameCell.querySelector("span.font-medium") || nameCell.querySelector("span");
    if (nameText) {
      nameText.textContent = deal.name || "Untitled Deal";
      nameText.setAttribute("data-activated", "true");
    }

    var stageCell = cells[1];
    var stageBadge = stageCell.querySelector("span");
    if (stageBadge) {
      stageBadge.textContent = deal.stage || "-";
      stageBadge.setAttribute("data-activated", "true");
    } else {
      setCellText(stageCell, deal.stage || "-");
    }

    var statusCell = cells[2];
    var statusText = statusCell.querySelector("span.text-gray-300") || statusCell.querySelector("span");
    if (statusText) {
      statusText.textContent = deal.createdLabel || "-";
      statusText.setAttribute("data-activated", "true");
    } else {
      setCellText(statusCell, deal.createdLabel || "-");
    }

    var amountCell = cells[3];
    setCellText(amountCell, deal.amountLabel || "-");

    row.setAttribute("data-activated", "true");
  }

  function bindRowNavigation(row, dealId) {
    if (!dealId) return;
    row.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign("/deals/" + dealId + "/command");
    });
  }

  function applyRows(data) {
    var root = document.querySelector('[data-stitch-slug="deal-intake-console"]');
    var tbody = findQueueTbody(root);
    if (!tbody) return;
    var template = tbody.querySelector("tr");
    if (!template) return;

    tbody.innerHTML = "";

    if (!data || data.error) {
      var errRow = template.cloneNode(true);
      updateRow(errRow, {
        name: data && data.error ? data.error : "Failed to load deals",
        stage: "Error",
        createdLabel: "-",
        amountLabel: "-",
      });
      tbody.appendChild(errRow);
      return;
    }

    if (!data.rows || !data.rows.length) {
      var emptyRow = template.cloneNode(true);
      updateRow(emptyRow, {
        name: "No intake deals",
        stage: "-",
        createdLabel: "-",
        amountLabel: "-",
      });
      tbody.appendChild(emptyRow);
      return;
    }

    data.rows.forEach(function (deal) {
      var row = template.cloneNode(true);
      updateRow(row, deal);
      bindRowNavigation(row, deal.id);
      tbody.appendChild(row);
    });
  }

  function wireCreateDeal() {
    var root = document.querySelector('[data-stitch-slug="deal-intake-console"]');
    var scope = root || document;
    var buttons = Array.prototype.slice.call(scope.querySelectorAll("button"));
    var button = buttons.find(function (btn) {
      return (btn.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "create deal & open";
    });
    if (!button) return;

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign("/deals/new");
    });
  }

  var data = getData();
  applyRows(data || {});
  wireCreateDeal();
})();
`;
}
