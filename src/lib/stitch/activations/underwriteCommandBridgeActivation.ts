import { listDealsForBank } from "@/lib/deals/listDeals";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { resolveDealLabel } from "@/lib/deals/dealLabel";

export type UnderwriteCommandActivationRow = {
  id: string;
  name: string;
  subtitle: string;
  stage: string;
  borrower?: string;
  locationLabel?: string | null;
  dscrLabel: string;
  ltvLabel: string;
  noiLabel: string;
  occupancyLabel: string;
  scoreLabel: string;
  missingLabel: string;
  riskLabel: string;
  nextAction: string;
  updatedLabel: string;
  ownerInitials: string;
  actionLabel?: string;
  needsName?: boolean;
};

export type UnderwriteCommandActivationData = {
  mode: "deal" | "pipeline";
  rows?: UnderwriteCommandActivationRow[];
  deal?: {
    id: string;
    name: string;
    displayName?: string | null;
    nickname?: string | null;
    needsName?: boolean;
    borrower: string;
    amountLabel: string;
    stage: string;
    borrowerEmail?: string | null;
    borrowerName?: string | null;
  };
  checklist?: {
    required: number;
    received: number;
    missing: number;
    missingKeys: string[];
  };
  documents?: Array<{
    id: string;
    name: string;
    checklistKey?: string | null;
    source?: string | null;
    uploadedAt?: string | null;
    sizeLabel?: string | null;
  }>;
  ledger?: Array<{
    id: string;
    title: string;
    detail?: string | null;
    at?: string | null;
    level?: "info" | "success" | "warning" | "error";
  }>;
  kpis?: {
    activeDeals?: number;
    needsAttention?: number;
    missingDocs?: number;
    riskFlags?: number;
    slaBreaches?: number;
    newUploads?: number;
  };
  error?: string;
};

const DEFAULT_LIMIT = 25;

function formatMoney(amount: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function initialsFromName(name: string): string {
  const clean = String(name || "").trim();
  if (!clean) return "--";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function buildSubtitle(borrower: string, amountLabel: string): string {
  const borrowerLabel = borrower && borrower !== "-" ? borrower : "Unknown borrower";
  if (amountLabel && amountLabel !== "-") return `${borrowerLabel} • ${amountLabel}`;
  return borrowerLabel;
}

export async function getUnderwriteCommandBridgeActivationData(
  dealId?: string | null,
  limit = DEFAULT_LIMIT
): Promise<UnderwriteCommandActivationData> {
  const resolvedDealId = dealId ? String(dealId).trim() : "";
  if (resolvedDealId) {
    try {
      const access = await ensureDealBankAccess(resolvedDealId);
      if (!access.ok) {
        return { mode: "deal", error: access.error };
      }

      const sb = supabaseAdmin();

      const { data: deal, error: dealError } = await sb
        .from("deals")
        .select("id, borrower_name, name, display_name, nickname, amount, stage")
        .eq("id", resolvedDealId)
        .maybeSingle();

      if (dealError || !deal) {
        return { mode: "deal", error: "Deal not found" };
      }

      const { data: intake } = await sb
        .from("deal_intake")
        .select("borrower_name, borrower_email")
        .eq("deal_id", resolvedDealId)
        .maybeSingle();

      const borrowerName = String(intake?.borrower_name ?? deal.borrower_name ?? deal.name ?? "-") || "-";
      const borrowerEmail = intake?.borrower_email ? String(intake.borrower_email) : null;
      const labelResult = resolveDealLabel({
        id: String(deal.id),
        display_name: (deal as any).display_name ?? null,
        nickname: (deal as any).nickname ?? null,
        borrower_name: deal.borrower_name ?? null,
        name: deal.name ?? null,
        legal_name: (deal as any).legal_name ?? null,
      });
      const name = labelResult.label;
      const amountLabel = formatMoney(deal.amount);
      const stage = String(deal.stage ?? "-") || "-";

      const { data: checklist } = await sb
        .from("deal_checklist_items")
        .select("checklist_key, required, received_at")
        .eq("deal_id", resolvedDealId);

      const checklistRequired = (checklist ?? []).filter((item: any) => item.required);
      const checklistReceived = checklistRequired.filter((item: any) => item.received_at);
      const missingKeys = checklistRequired
        .filter((item: any) => !item.received_at)
        .map((item: any) => String(item.checklist_key ?? "Missing item"));

      const { data: documents } = await sb
        .from("deal_documents")
        .select("id, original_filename, checklist_key, created_at, source, size_bytes")
        .eq("deal_id", resolvedDealId)
        .eq("bank_id", access.bankId)
        .order("created_at", { ascending: false })
        .limit(limit);

      const { data: ledger } = await sb
        .from("audit_ledger")
        .select("id, action, kind, scope, input_json, output_json, created_at, requires_human_review")
        .eq("deal_id", resolvedDealId)
        .order("created_at", { ascending: false })
        .limit(8);

      const docs = (documents ?? []).map((doc: any) => ({
        id: String(doc.id),
        name: String(doc.original_filename ?? "Document"),
        checklistKey: doc.checklist_key ? String(doc.checklist_key) : null,
        source: doc.source ? String(doc.source) : null,
        uploadedAt: doc.created_at ? String(doc.created_at) : null,
        sizeLabel: formatFileSize(doc.size_bytes),
      }));

      const ledgerItems = (ledger ?? []).map((row: any) => {
        const title = String(row.action ?? row.kind ?? "Event");
        const detail = row.scope ? String(row.scope) : null;
        const requiresReview = Boolean(row.requires_human_review);
        return {
          id: String(row.id),
          title,
          detail,
          at: row.created_at ? String(row.created_at) : null,
          level: requiresReview ? "warning" : "info",
        } as const;
      });

      return {
        mode: "deal",
        deal: {
          id: String(deal.id),
          name,
          displayName: (deal as any).display_name ?? null,
          nickname: (deal as any).nickname ?? null,
          needsName: labelResult.needsName,
          borrower: borrowerName,
          amountLabel,
          stage,
          borrowerEmail,
          borrowerName,
        },
        checklist: {
          required: checklistRequired.length,
          received: checklistReceived.length,
          missing: missingKeys.length,
          missingKeys: missingKeys.slice(0, 6),
        },
        documents: docs,
        ledger: ledgerItems,
        kpis: {
          activeDeals: 1,
          needsAttention: missingKeys.length > 0 ? 1 : 0,
          missingDocs: missingKeys.length,
          riskFlags: 0,
          slaBreaches: 0,
          newUploads: docs.length,
        },
      };
    } catch (error) {
      console.error("[/underwrite activation] deal_load_failed:", error);
      return { mode: "deal", error: "Failed to load deal" };
    }
  }

  try {
    const deals = await listDealsForBank(limit);
    const rows = deals.map((deal) => ({
      id: deal.id,
      name: deal.label || deal.name || "Untitled Deal",
      subtitle: buildSubtitle(deal.borrower || "-", deal.amountLabel || "-"),
      borrower: deal.borrower || "-",
      locationLabel: "-",
      stage: deal.stageLabel || deal.stage || "-",
      dscrLabel: "-",
      ltvLabel: "-",
      noiLabel: "-",
      occupancyLabel: "-",
      scoreLabel: "-",
      missingLabel: "-",
      riskLabel: "-",
      nextAction: deal.status || "Review",
      actionLabel: "Open Underwriting →",
      updatedLabel: deal.createdLabel || "-",
      ownerInitials: initialsFromName(deal.borrower || deal.name || ""),
      needsName: deal.needsName ?? false,
    }));

    return { mode: "pipeline", rows: rows.slice(0, limit) };
  } catch (error) {
    console.error("[/underwrite activation] deals_load_failed:", error);
    return { mode: "pipeline", rows: [], error: "Failed to load deals" };
  }
}

export function serializeActivationData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildUnderwriteCommandBridgeActivationScript(): string {
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

  function getRoot() {
    return document.querySelector('[data-stitch-slug="deals-command-bridge"]');
  }

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findDealsTbody(root) {
    if (!root) return null;
    var tables = Array.prototype.slice.call(root.querySelectorAll("table"));
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var headers = Array.prototype.slice.call(table.querySelectorAll("thead th"));
      if (!headers.length) continue;
      var headerText = headers.map(function (th) { return normalize(th.textContent); }).join("|");
      if (headerText.indexOf("deal name") !== -1 && headerText.indexOf("stage") !== -1) {
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

  function warn(message) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[underwrite activation] " + message);
    }
  }

  function scheduleAfterReady(fn) {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
      return;
    }
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () { fn(); });
      return;
    }
    setTimeout(fn, 0);
  }

  function storeLastActiveDeal(data) {
    if (!data || !data.deal || !data.deal.id) return;
    scheduleAfterReady(function () {
      try {
        var payload = {
          dealId: data.deal.id,
          dealName: data.deal.name || null,
          updatedAt: new Date().toISOString(),
        };
        window.localStorage.setItem("lastActiveDeal", JSON.stringify(payload));
      } catch (_e) {
        // Silent: localStorage unavailable.
      }
    });
  }

  function injectResumeCta(root) {
    if (!root) return;
    if (root.getAttribute("data-resume-bound") === "true") return;
    scheduleAfterReady(function () {
      var lastDealId = null;
      var lastDealName = null;
      try {
        var raw = window.localStorage.getItem("lastActiveDeal");
        if (raw) {
          var parsed = JSON.parse(raw);
          lastDealId = parsed && parsed.dealId ? String(parsed.dealId) : null;
          lastDealName = parsed && parsed.dealName ? String(parsed.dealName) : null;
        }
      } catch (_e) {
        return;
      }

      if (!lastDealId) return;

      var buttons = Array.prototype.slice.call(root.querySelectorAll("button"));
      var newDealButton = buttons.find(function (btn) {
        return normalize(btn.textContent).indexOf("new deal") !== -1;
      });

      if (!newDealButton || !newDealButton.parentElement) {
        return;
      }

      var actionRow = newDealButton.parentElement;
      if (actionRow.querySelector("[data-resume-underwrite='true']")) return;

      var resumeButton = newDealButton.cloneNode(true);
      resumeButton.setAttribute("data-resume-underwrite", "true");
      resumeButton.removeAttribute("disabled");
      resumeButton.innerHTML =
        '<span class="material-symbols-outlined text-[20px]">play_circle</span>' +
        (lastDealName ? "Open Underwriting → " + lastDealName : "Open Underwriting →");

      resumeButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign("/deals/" + lastDealId + "/underwrite");
      });

      actionRow.insertBefore(resumeButton, newDealButton);
      root.setAttribute("data-resume-bound", "true");
    });
  }

  function setKpi(label, valueText) {
    if (!valueText && valueText !== 0) return;
    var root = getRoot() || document;
    var labels = Array.prototype.slice.call(root.querySelectorAll(".glass-panel span.text-xs"));
    var match = labels.find(function (node) {
      return normalize(node.textContent) === normalize(label);
    });
    if (!match) return;
    var card = match.closest(".glass-panel");
    if (!card) return;
    var value = card.querySelector("span.text-2xl");
    if (value) {
      value.textContent = String(valueText);
      value.setAttribute("data-activated", "true");
    }
  }

  function updateKpis(data) {
    if (!data || !data.kpis) return;
    setKpi("Active Deals", data.kpis.activeDeals);
    setKpi("Needs Attention", data.kpis.needsAttention);
    setKpi("Missing Docs", data.kpis.missingDocs);
    setKpi("Risk Flags", data.kpis.riskFlags);
    setKpi("SLA Breaches", data.kpis.slaBreaches);
    setKpi("New Uploads", data.kpis.newUploads);
  }

  function applyContextPill(root, mode) {
    if (!root) return;
    var header = root.querySelector("h2");
    if (!header || !header.parentElement) return;

    var pill = header.parentElement.querySelector("[data-bridge-context-pill='true']");
    if (!pill) {
      pill = document.createElement("span");
      pill.setAttribute("data-bridge-context-pill", "true");
      pill.className =
        "inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80";
      header.parentElement.insertBefore(pill, header);
    }

    pill.textContent = mode === "deal" ? "UNDERWRITING" : "PIPELINE";
  }

  function updateHeaderContext(root, mode) {
    if (!root) return;
    var header = root.querySelector("h2");
    if (!header) return;
    var subtitle = header.parentElement ? header.parentElement.querySelector("p") : null;

    if (mode === "deal") {
      header.textContent = "Underwriting";
      if (subtitle) subtitle.textContent = "Deal workspace • Review docs • Make decisions";
    } else {
      header.textContent = "Pipeline Command Bridge";
      if (subtitle) subtitle.textContent = "Browse pipeline • Pick a deal • Launch Underwriting";
    }

    applyContextPill(root, mode);
  }

  function applyPipelineTableLayout(root) {
    if (!root) return;
    var table = root.querySelector("table");
    if (!table) return;
    if (!table.classList.contains("pipeline-condensed")) {
      table.classList.add("pipeline-condensed");
    }

    if (!document.getElementById("__pipeline_condensed_styles__")) {
      var style = document.createElement("style");
      style.id = "__pipeline_condensed_styles__";
      style.textContent = "table.pipeline-condensed th:nth-child(n+6), table.pipeline-condensed td:nth-child(n+6) { display: none; }";
      document.head.appendChild(style);
    }

    var headers = table.querySelectorAll("thead th");
    if (headers.length >= 5) {
      headers[0].textContent = "Deal Name";
      headers[1].textContent = "Borrower";
      headers[2].textContent = "City/State";
      headers[3].textContent = "Stage";
      headers[4].textContent = "Action";
    }
  }

  function renameResumeButtons(root) {
    if (!root) return;
    var buttons = Array.prototype.slice.call(root.querySelectorAll("button"));
    buttons.forEach(function (btn) {
      var text = normalize(btn.textContent);
      if (text.indexOf("resume underwriting") !== -1) {
        btn.textContent = "Open Underwriting →";
      }
    });
  }

  function updateRow(row, deal) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 12) return;

    var nameCell = cells[0];
    var nameText = nameCell.querySelector("span.text-white") || nameCell.querySelector("span.font-semibold") || nameCell.querySelector("span");
    if (nameText) {
      nameText.textContent = deal.name || "Untitled Deal";
      nameText.setAttribute("data-activated", "true");
    }
    var subtitleText = nameCell.querySelector("span.text-xs") || nameCell.querySelector("span.text-gray-500");
    if (subtitleText) {
      subtitleText.textContent = deal.subtitle || "-";
      subtitleText.setAttribute("data-activated", "true");
    }

    if (deal.needsName) {
      var badge = nameCell.querySelector("[data-needs-name='true']");
      if (!badge) {
        badge = document.createElement("span");
        badge.setAttribute("data-needs-name", "true");
        badge.className = "ml-2 inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300";
        badge.textContent = "Needs name";
        nameCell.appendChild(badge);
      }

      var nameButton = nameCell.querySelector("[data-name-action='true']");
      if (!nameButton) {
        nameButton = document.createElement("button");
        nameButton.setAttribute("data-name-action", "true");
        nameButton.className = "ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80 hover:bg-white/10";
        nameButton.textContent = "Name this deal";
        nameButton.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();

          var nextName = window.prompt("Enter a deal name", deal.name || "");
          if (!nextName) return;

          fetch("/api/deals/" + deal.id + "/name", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: nextName }),
          })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (payload) {
              if (!payload || !payload.ok) return;
              nameText.textContent = payload.display_name || nextName;
              nameText.setAttribute("data-activated", "true");
              if (badge && badge.parentElement) badge.parentElement.removeChild(badge);
              if (nameButton && nameButton.parentElement) nameButton.parentElement.removeChild(nameButton);
            })
            .catch(function () {});
        });
        nameCell.appendChild(nameButton);
      }
    }

    var stageCell = cells[1];
    var stageBadge = stageCell.querySelector("span");
    var isPipelineRow = !!(deal.borrower || deal.locationLabel || deal.actionLabel);

    if (isPipelineRow) {
      setCellText(stageCell, deal.borrower || "-");
      setCellText(cells[2], deal.locationLabel || "-");
      setCellText(cells[3], deal.stage || "-");
      setCellText(cells[4], deal.actionLabel || "Open Underwriting →");
      setCellText(cells[5], "-");
      setCellText(cells[6], "-");
      setCellText(cells[7], "-");
      setCellText(cells[8], "-");
      setCellText(cells[9], deal.updatedLabel || "-");
      setCellText(cells[10], "-");
    } else if (stageBadge) {
      stageBadge.textContent = deal.stage || "-";
      stageBadge.setAttribute("data-activated", "true");
    } else {
      setCellText(stageCell, deal.stage || "-");
    }

    if (!isPipelineRow) {
      setCellText(cells[2], deal.dscrLabel || "-");
      setCellText(cells[3], deal.ltvLabel || "-");
      setCellText(cells[4], deal.noiLabel || "-");
      setCellText(cells[5], deal.occupancyLabel || "-");
      setCellText(cells[6], deal.scoreLabel || "-");
      setCellText(cells[7], deal.missingLabel || "-");
      setCellText(cells[8], deal.riskLabel || "-");
      setCellText(cells[9], deal.nextAction || "-");
      setCellText(cells[10], deal.updatedLabel || "-");
    }

    var ownerCell = cells[11];
    var ownerBadge = ownerCell.querySelector("div");
    if (ownerBadge) {
      ownerBadge.textContent = deal.ownerInitials || "--";
      ownerBadge.setAttribute("data-activated", "true");
    } else {
      setCellText(ownerCell, deal.ownerInitials || "--");
    }

    row.setAttribute("data-activated", "true");
  }

  function updateDocumentRow(row, doc) {
    var cells = row.querySelectorAll("td");
    if (cells.length < 12) return;

    var nameCell = cells[0];
    var nameText = nameCell.querySelector("span.text-white") || nameCell.querySelector("span.font-semibold") || nameCell.querySelector("span");
    if (nameText) {
      nameText.textContent = doc.name || "Document";
      nameText.setAttribute("data-activated", "true");
    }
    var subtitleText = nameCell.querySelector("span.text-xs") || nameCell.querySelector("span.text-gray-500");
    if (subtitleText) {
      subtitleText.textContent = doc.checklistKey || doc.source || "Uploaded document";
      subtitleText.setAttribute("data-activated", "true");
    }

    setCellText(cells[1], doc.source || "-");
    setCellText(cells[2], "-");
    setCellText(cells[3], "-");
    setCellText(cells[4], doc.sizeLabel || "-");
    setCellText(cells[5], "-");
    setCellText(cells[6], "-");
    setCellText(cells[7], "-");
    setCellText(cells[8], "-");
    setCellText(cells[9], "View");
    setCellText(cells[10], doc.uploadedAt || "-");
    setCellText(cells[11], "--");

    row.setAttribute("data-doc-id", doc.id || "");
    row.setAttribute("data-doc-name", doc.name || "Document");
    row.setAttribute("data-activated", "true");
  }

  function bindRowNavigation(row, dealId) {
    if (!dealId) return;
    row.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign("/deals/" + dealId + "/underwrite");
    });
  }

  function applyRows(data) {
    var root = getRoot();
    var tbody = findDealsTbody(root || document);
    if (!tbody) return;
    var template = tbody.querySelector("tr");
    if (!template) return;

    tbody.innerHTML = "";

    if (!data || data.error) {
      var errRow = template.cloneNode(true);
      updateRow(errRow, {
        name: data && data.error ? data.error : "Failed to load deals",
        subtitle: "-",
        stage: "Error",
        dscrLabel: "-",
        ltvLabel: "-",
        noiLabel: "-",
        occupancyLabel: "-",
        scoreLabel: "-",
        missingLabel: "-",
        riskLabel: "-",
        nextAction: "-",
        updatedLabel: "-",
        ownerInitials: "--",
      });
      tbody.appendChild(errRow);
      return;
    }

    if (data.mode === "deal") {
      if (data.documents && data.documents.length) {
        data.documents.forEach(function (doc) {
          var row = template.cloneNode(true);
          updateDocumentRow(row, doc);
          tbody.appendChild(row);
        });
      } else {
        var emptyDocRow = template.cloneNode(true);
        updateDocumentRow(emptyDocRow, {
          name: "No documents uploaded",
          checklistKey: "-",
          source: "-",
          uploadedAt: "-",
          sizeLabel: "-",
        });
        tbody.appendChild(emptyDocRow);
      }
      return;
    }

    if (!data.rows || !data.rows.length) {
      var emptyRow = template.cloneNode(true);
      updateRow(emptyRow, {
        name: "No underwriting deals",
        subtitle: "-",
        stage: "-",
        dscrLabel: "-",
        ltvLabel: "-",
        noiLabel: "-",
        occupancyLabel: "-",
        scoreLabel: "-",
        missingLabel: "-",
        riskLabel: "-",
        nextAction: "-",
        updatedLabel: "-",
        ownerInitials: "--",
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

  function findCardByTitle(title) {
    var root = getRoot() || document;
    var headings = Array.prototype.slice.call(root.querySelectorAll(".glass-panel .text-xs.font-bold"));
    return headings.find(function (node) {
      return normalize(node.textContent) === normalize(title);
    });
  }

  function bindDocumentClicks(root, data) {
    if (!root || !data || data.mode !== "deal") return;
    var tbody = findDealsTbody(root);
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
    rows.forEach(function (row) {
      if (row.getAttribute("data-doc-bound") === "true") return;
      row.setAttribute("data-doc-bound", "true");

      var nameCell = row.querySelector("td");
      if (!nameCell) return;
      nameCell.style.cursor = "pointer";
      nameCell.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();

        var docId = row.getAttribute("data-doc-id");
        if (!docId) {
          warn("No document id available for viewer.");
          return;
        }

        if (!data.deal || !data.deal.id) {
          warn("No deal id available for document viewer.");
          return;
        }

        var dealId = data.deal.id;
        var documentId = docId;
        if (!dealId || !documentId) {
          warn("Missing dealId or documentId for document viewer.");
          return;
        }

        var target = \`/deals/\${dealId}/documents/\${documentId}\`;
        if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
          console.assert(
            /^\/deals\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/i.test(target),
            "[underwrite activation] document viewer URL invalid:",
            target
          );
        }

        window.location.assign(target);
      });
    });
  }

  function updateNowActingOn(data) {
    if (!data || !data.deal) return;
    var heading = findCardByTitle("Now Acting On");
    if (!heading) return;
    var card = heading.closest(".glass-panel");
    if (!card) return;

    var title = card.querySelector("h3");
    if (title) {
      title.textContent = data.deal.name;
      title.setAttribute("data-activated", "true");
    }

    var sub = card.querySelector("p.text-xs");
    if (sub) {
      var pieces = [data.deal.stage, data.deal.amountLabel, data.deal.borrower].filter(Boolean);
      sub.textContent = pieces.join(" • ");
      sub.setAttribute("data-activated", "true");
    }

    var button = card.querySelector("button");
    if (button) {
      button.textContent = "Open Underwriting →";
      button.setAttribute("data-readonly", "true");
      button.disabled = false;
      button.addEventListener("click", function () {
        window.location.assign("/deals/" + data.deal.id + "/underwrite");
      });
    }
  }

  function updateLiveIntelligence(data) {
    var heading = findCardByTitle("Live Intelligence");
    if (!heading) return;
    var card = heading.closest(".glass-panel");
    if (!card) return;
    var items = Array.prototype.slice.call(card.querySelectorAll(".border-l-2"));
    items.forEach(function (item) { item.remove(); });

    var ledger = (data && data.ledger) ? data.ledger.slice(0, 3) : [];
    if (!ledger.length) {
      var empty = document.createElement("div");
      empty.className = "flex gap-3 items-start border-l-2 border-gray-500/40 pl-3 py-1";
      empty.innerHTML = '<div class="flex flex-col gap-0.5"><p class="text-sm text-gray-400 leading-snug">No recent events.</p></div>';
      card.appendChild(empty);
      return;
    }

    ledger.forEach(function (event, idx) {
      var wrapper = document.createElement("div");
      var color = event.level === "warning" ? "amber" : event.level === "error" ? "rose" : "blue";
      wrapper.className = "flex gap-3 items-start border-l-2 border-" + color + "-500 pl-3 py-1";
      var time = event.at ? event.at : "";
      wrapper.innerHTML = '<div class="flex flex-col gap-0.5"><p class="text-sm text-gray-200 leading-snug">' +
        (event.title || "Update") + (event.detail ? ": <span class=\"text-white font-medium\">" + event.detail + "</span>" : "") +
        '</p><span class="text-[10px] text-gray-500">' + time + '</span></div>';
      card.appendChild(wrapper);
    });
  }

  function updateConditions(data) {
    var heading = findCardByTitle("Conditions");
    if (!heading) return;
    var card = heading.closest(".glass-panel");
    if (!card) return;

    var badge = card.querySelector("span.bg-rose-500\/20") || card.querySelector("span.text-rose-400");
    if (badge && data && data.checklist) {
      badge.textContent = data.checklist.missing + " Missing";
      badge.setAttribute("data-activated", "true");
    }

    var list = card.querySelector(".space-y-2");
    if (!list) return;
    list.innerHTML = "";

    var missing = (data && data.checklist && data.checklist.missingKeys) ? data.checklist.missingKeys : [];
    if (!missing.length) {
      var okItem = document.createElement("div");
      okItem.className = "flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5";
      okItem.innerHTML = '<div class="flex items-center gap-2"><span class="material-symbols-outlined text-emerald-400 text-[18px]">check</span><span class="text-xs text-gray-300">All required items received</span></div><span class="text-[10px] text-gray-500 bg-black/20 px-1.5 rounded">Complete</span>';
      list.appendChild(okItem);
    } else {
      missing.slice(0, 4).forEach(function (item) {
        var row = document.createElement("div");
        row.className = "flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5";
        row.innerHTML = '<div class="flex items-center gap-2"><span class="material-symbols-outlined text-rose-400 text-[18px]">error</span><span class="text-xs text-gray-300">' + item + '</span></div><span class="text-[10px] text-gray-500 bg-black/20 px-1.5 rounded">Required</span>';
        list.appendChild(row);
      });
    }

    var button = card.querySelector("button");
    if (button) {
      var canRequest = Boolean(
        data &&
          data.deal &&
          data.deal.borrowerEmail &&
          data.checklist &&
          data.checklist.missingKeys &&
          data.checklist.missingKeys.length
      );

      if (button.getAttribute("data-request-bound") !== "true") {
        button.setAttribute("data-request-bound", "true");
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();

          if (!canRequest) {
            warn("Request Info unavailable (missing borrower email or checklist).");
            return;
          }

          var dealId = data.deal.id;
          var missingKeys = data.checklist.missingKeys || [];
          if (!missingKeys.length) {
            warn("No missing checklist keys to request.");
            return;
          }

          fetch("/api/deals/" + dealId + "/borrower-request/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channels: ["email"],
              email: data.deal.borrowerEmail,
              borrowerName: data.deal.borrowerName || null,
              checklistKeys: missingKeys,
              label: "Missing document request",
            }),
          })
            .then(function (res) {
              if (!res.ok) throw new Error("request_failed");
              return res.json();
            })
            .then(function () {
              var eventItem = {
                id: "req-" + Date.now(),
                title: "Request sent",
                detail: "Requested " + missingKeys.length + " items",
                at: new Date().toISOString(),
                level: "info",
              };
              data.ledger = [eventItem].concat(data.ledger || []);
              updateLiveIntelligence(data);

              fetch("/api/deals/" + dealId + "/progress")
                .then(function (res) { return res.ok ? res.json() : null; })
                .then(function (progress) {
                  if (progress && progress.ok && progress.checklist) {
                    var required = progress.checklist.required || 0;
                    var received = progress.checklist.received_required || 0;
                    data.checklist.required = required;
                    data.checklist.received = received;
                    data.checklist.missing = Math.max(0, required - received);
                    updateConditions(data);
                    updateRecommendation(data);
                  }
                })
                .catch(function () {
                  warn("Failed to refresh checklist progress.");
                });
            })
            .catch(function () {
              warn("Failed to send request bundle.");
            });
        });
      }

      if (canRequest) {
        button.removeAttribute("data-readonly");
        button.disabled = false;
        button.classList.remove("opacity-50", "cursor-not-allowed");
      } else {
        button.setAttribute("data-readonly", "true");
        button.disabled = true;
        button.classList.add("opacity-50", "cursor-not-allowed");
      }
    }
  }

  function updateRecommendation(data) {
    var heading = findCardByTitle("Recommendation");
    if (!heading) return;
    var card = heading.closest(".glass-panel");
    if (!card) return;
    var text = card.querySelector("p");
    if (!text || !data || !data.checklist) return;
    var summary = "Checklist: " + data.checklist.received + "/" + data.checklist.required + " required items received.";
    if (data.documents) {
      summary += " Documents uploaded: " + data.documents.length + ".";
    }
    text.textContent = summary;
    text.setAttribute("data-activated", "true");

    var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
    var primary = buttons[0];
    var secondary = buttons[1];

    if (primary) {
      var dealId = data && data.deal ? data.deal.id : null;
      if (primary.getAttribute("data-primary-bound") !== "true") {
        primary.setAttribute("data-primary-bound", "true");
        primary.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();

          if (!dealId) {
            warn("Recommendation action unavailable (missing deal id).");
            return;
          }

          fetch("/api/deals/" + dealId + "/upload-links/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: "Underwrite request link" }),
          })
            .then(function (res) {
              if (!res.ok) throw new Error("link_failed");
              return res.json();
            })
            .then(function (payload) {
              var url = payload && payload.url;
              if (url && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).catch(function () {});
              }
            })
            .catch(function () {
              warn("Failed to generate upload link.");
            });
        });
      }

      if (dealId) {
        primary.removeAttribute("data-readonly");
        primary.disabled = false;
        primary.classList.remove("opacity-50", "cursor-not-allowed");
      } else {
        primary.setAttribute("data-readonly", "true");
        primary.disabled = true;
        primary.classList.add("opacity-50", "cursor-not-allowed");
      }
    }

    if (secondary) {
      secondary.setAttribute("data-readonly", "true");
      secondary.disabled = true;
      secondary.classList.add("opacity-50", "cursor-not-allowed");
    }
  }

  var data = getData();
  var isDevHost = false;
  try {
    if (typeof window !== "undefined" && window.location && window.location.hostname) {
      var host = window.location.hostname;
      isDevHost = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
    }
  } catch (_e) {
    isDevHost = false;
  }
  if (isDevHost && typeof console !== "undefined" && console.info) {
    console.info("[underwrite]", {
      route: "underwrite",
      dealId: data && data.deal ? data.deal.id : null,
      mode: data ? data.mode : null,
    });
  }
  updateHeaderContext(getRoot(), data && data.mode ? data.mode : "pipeline");
  if (data && data.mode === "pipeline") {
    applyPipelineTableLayout(getRoot());
    renameResumeButtons(getRoot());
  }

  updateKpis(data || {});
  if (data && data.mode === "deal") {
    storeLastActiveDeal(data);
    updateNowActingOn(data);
    updateLiveIntelligence(data);
    updateConditions(data);
    updateRecommendation(data);
  } else {
    injectResumeCta(getRoot());
  }
  applyRows(data || {});
  bindDocumentClicks(getRoot(), data || {});
})();
`;
}
