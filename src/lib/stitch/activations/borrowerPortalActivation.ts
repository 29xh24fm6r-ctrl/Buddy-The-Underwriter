// Portal Context Contract:
// - token query param name: ?token=<borrower_portal_token>
// - verifier: requireValidInvite(token) -> { deal_id, bank_id, expires_at, ... }
// - missing/invalid: return minimal inline state (error message) and do not throw
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { ensureDefaultPortalStatus, listChecklist } from "@/lib/portal/checklist";

export type BorrowerPortalUpload = {
  id: string;
  filename: string;
  createdAt: string | null;
  status: string;
};

export type BorrowerPortalChecklist = {
  required: number;
  received: number;
  missing: number;
  missingItems: Array<{ title: string }>;
};

export type BorrowerPortalActivationData = {
  token: string | null;
  dealId: string | null;
  uploads: BorrowerPortalUpload[];
  checklist: BorrowerPortalChecklist;
  error?: string;
};

const DEFAULT_LIMIT = 25;

export async function getBorrowerPortalActivationData(
  token: string | null,
  limit = DEFAULT_LIMIT
): Promise<BorrowerPortalActivationData> {
  if (!token) {
    return {
      token: null,
      dealId: null,
      uploads: [],
      checklist: { required: 0, received: 0, missing: 0, missingItems: [] },
      error: "Missing portal token",
    };
  }

  let dealId: string;
  let bankId: string;

  try {
    const invite = await requireValidInvite(token);
    dealId = invite.deal_id;
    bankId = invite.bank_id;
  } catch (error) {
    console.error("[/borrower/portal activation] invalid token:", error);
    return {
      token,
      dealId: null,
      uploads: [],
      checklist: { required: 0, received: 0, missing: 0, missingItems: [] },
      error: "Invalid or expired portal link",
    };
  }

  const sb = supabaseAdmin();

  const uploadsRes = await sb
    .from("borrower_upload_inbox")
    .select("id, filename, created_at, status")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (uploadsRes.error) {
    console.error("[/borrower/portal activation] uploads_load_failed:", uploadsRes.error);
  }

  let checklistRows: any[] = [];
  try {
    await ensureDefaultPortalStatus(dealId);
    checklistRows = (await listChecklist(dealId)) ?? [];
  } catch (error) {
    console.error("[/borrower/portal activation] checklist_load_failed:", error);
  }

  const requiredRows = checklistRows.filter((r: any) => !!r?.item?.required);
  const missingRows = requiredRows.filter((r: any) => (r?.state?.status ?? "missing") === "missing");
  const receivedRows = requiredRows.filter((r: any) => (r?.state?.status ?? "missing") !== "missing");

  const checklist: BorrowerPortalChecklist = {
    required: requiredRows.length,
    received: receivedRows.length,
    missing: missingRows.length,
    missingItems: missingRows.slice(0, 6).map((r: any) => ({
      title: String(r?.item?.title ?? "Missing document"),
    })),
  };

  const uploads: BorrowerPortalUpload[] = (uploadsRes.data ?? []).map((row: any) => ({
    id: String(row.id ?? ""),
    filename: String(row.filename ?? "Untitled"),
    createdAt: row.created_at ?? null,
    status: String(row.status ?? "received"),
  }));

  void bankId;

  return {
    token,
    dealId,
    uploads,
    checklist,
  };
}

export function serializeActivationData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildBorrowerPortalActivationScript(): string {
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
    return document.querySelector('[data-stitch-slug="borrower-document-upload-review"]');
  }

  function formatDate(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  }

  function fileExtension(filename) {
    if (!filename) return "FILE";
    var parts = filename.split(".");
    if (parts.length < 2) return "FILE";
    return parts[parts.length - 1].toUpperCase();
  }

  function normalizeStatus(status) {
    var value = String(status || "").toLowerCase();
    if (value.includes("fail") || value.includes("error")) return "Failed";
    if (value.includes("processing") || value.includes("queued")) return "Processing...";
    if (value.includes("attached") || value.includes("matched") || value.includes("received")) return "Confirmed";
    if (value.includes("unmatched") || value.includes("pending")) return "Ready for Review";
    return "Received";
  }

  function setBadgeText(badge, text) {
    if (!badge) return;
    var icon = badge.querySelector(".material-symbols-outlined");
    badge.textContent = "";
    if (icon) badge.appendChild(icon);
    var textNode = document.createTextNode(" " + text);
    badge.appendChild(textNode);
  }

  function applyUploads(root, uploads, errorText) {
    var aside = root.querySelector("main") ? root.querySelector("main").querySelector("aside") : root.querySelector("aside");
    if (!aside) return;
    var list = aside.querySelector(".custom-scrollbar");
    if (!list) return;

    var template = list.querySelector("div.flex.flex-col") || list.firstElementChild;
    if (!template) return;

    list.innerHTML = "";

    if (errorText) {
      var errRow = template.cloneNode(true);
      var errName = errRow.querySelector("p") || errRow.querySelector("p.text-sm");
      if (errName) errName.textContent = errorText;
      var errMeta = errRow.querySelector("p.text-gray-500");
      if (errMeta) errMeta.textContent = "";
      list.appendChild(errRow);
      return;
    }

    if (!uploads || uploads.length === 0) {
      var emptyRow = template.cloneNode(true);
      var emptyName = emptyRow.querySelector("p") || emptyRow.querySelector("p.text-sm");
      if (emptyName) emptyName.textContent = "No uploads yet";
      var emptyMeta = emptyRow.querySelector("p.text-gray-500");
      if (emptyMeta) emptyMeta.textContent = "";
      list.appendChild(emptyRow);
      return;
    }

    uploads.forEach(function (upload) {
      var row = template.cloneNode(true);
        var nameEl = row.querySelector("p.text-sm") || row.querySelector("p");
      if (nameEl) nameEl.textContent = upload.filename || "Untitled";
      var metaEl = row.querySelector("p.text-gray-500");
      if (metaEl) {
        metaEl.textContent = formatDate(upload.createdAt) + " • " + fileExtension(upload.filename);
      }
      var badge = row.querySelector("span.inline-flex");
      setBadgeText(badge, normalizeStatus(upload.status));
      list.appendChild(row);
    });
  }

  function applyChecklist(root, checklist) {
    var rightAside = root.querySelector("main") ? root.querySelectorAll("main aside")[1] : root.querySelectorAll("aside")[1];
    if (!rightAside) return;

    var progressText = rightAside.querySelector("span.text-sm.font-bold.text-primary");
    if (progressText) {
      progressText.textContent = String(checklist.received || 0) + " of " + String(checklist.required || 0) + " Docs";
    }

    var bar = rightAside.querySelector("div.h-2 div");
    if (bar) {
      var pct = checklist.required > 0 ? Math.min(100, Math.round((checklist.received / checklist.required) * 100)) : 0;
      bar.style.width = pct + "%";
    }

    var attentionCard = rightAside.querySelector("div.rounded-xl.bg-amber-50");
    if (attentionCard) {
      if (!checklist.missingItems || checklist.missingItems.length === 0) {
        attentionCard.style.display = "none";
      } else {
        attentionCard.style.display = "";
        var highlight = attentionCard.querySelector("span.font-bold") || attentionCard.querySelector("span.font-semibold");
        if (highlight) highlight.textContent = checklist.missingItems[0].title || "Missing document";
      }
    }
  }

  function updateToolbarFilename(root, uploads) {
    if (!uploads || uploads.length === 0) return;
    var toolbarName = root.querySelector("section .text-sm.font-semibold.text-gray-700");
    if (toolbarName) toolbarName.textContent = uploads[0].filename || toolbarName.textContent;
  }

  function setUploadError(root, message) {
    var aside = root.querySelector("main") ? root.querySelector("main").querySelector("aside") : root.querySelector("aside");
    if (!aside) return;
    var helper = aside.querySelector("p.text-xs.text-gray-500");
    if (helper && message) {
      helper.textContent = message;
    }
  }

  async function refreshData(data) {
    if (!data || !data.token || !data.dealId) return;
    try {
      var [uploadsRes, reqRes] = await Promise.all([
        fetch("/api/deals/" + data.dealId + "/uploads/inbox"),
        fetch("/api/borrower/portal/" + encodeURIComponent(data.token) + "/requests"),
      ]);

      var uploadsJson = await uploadsRes.json().catch(function () { return null; });
      var reqJson = await reqRes.json().catch(function () { return null; });

      if (uploadsRes.ok && uploadsJson && uploadsJson.rows) {
        var mapped = uploadsJson.rows.map(function (row) {
          return {
            id: String(row.id || ""),
            filename: String(row.filename || "Untitled"),
            createdAt: row.created_at || null,
            status: String(row.status || "received"),
          };
        });
        applyUploads(getRoot(), mapped, null);
        updateToolbarFilename(getRoot(), mapped);
      }

      if (reqRes.ok && reqJson && reqJson.ok) {
        var required = (reqJson.progress && typeof reqJson.progress.expected_count === "number") ? reqJson.progress.expected_count : 0;
        var received = (reqJson.progress && typeof reqJson.progress.uploaded_count === "number") ? reqJson.progress.uploaded_count : 0;
        var missingItems = Array.isArray(reqJson.missingItems) ? reqJson.missingItems.map(function (i) { return { title: i.title || "Missing document" }; }) : [];
        applyChecklist(getRoot(), {
          required: required,
          received: received,
          missing: Math.max(0, required - received),
          missingItems: missingItems,
        });
      }
    } catch (e) {
      setUploadError(getRoot(), "Upload complete, but refresh failed");
    }
  }

  async function uploadFile(data, file) {
    var prepRes = await fetch("/api/portal/upload/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: data.token,
        filename: file.name,
        mimeType: file.type || null,
      }),
    });

    var prepJson = await prepRes.json().catch(function () { return null; });
    if (!prepRes.ok || !prepJson || !prepJson.signedUrl) {
      throw new Error((prepJson && prepJson.error) || "Upload prepare failed");
    }

    var putRes = await fetch(prepJson.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error("Upload failed");
    }

    var commitRes = await fetch("/api/portal/upload/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: data.token,
        path: prepJson.path,
        filename: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
        requestId: null,
      }),
    });
    var commitJson = await commitRes.json().catch(function () { return null; });
    if (!commitRes.ok || (commitJson && commitJson.error)) {
      throw new Error((commitJson && commitJson.error) || "Upload commit failed");
    }
  }

  function wireUploadBox(root, data) {
    var uploadBox = root.querySelector("aside .border-2.border-dashed") || root.querySelector("aside .border-dashed");
    if (!uploadBox) return;

    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    uploadBox.appendChild(input);

    uploadBox.addEventListener("click", function (e) {
      e.preventDefault();
      if (!data || !data.token) {
        setUploadError(root, "Missing portal token");
        return;
      }
      input.click();
    });

    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      (async function () {
        for (var i = 0; i < files.length; i++) {
          try {
            await uploadFile(data, files[i]);
          } catch (err) {
            setUploadError(root, err && err.message ? err.message : "Upload failed");
            return;
          }
        }
        await refreshData(data);
      })();
      input.value = "";
    });
  }

  function wireSubmitButton(root) {
    var buttons = Array.prototype.slice.call(root.querySelectorAll("button"));
    var submit = buttons.find(function (btn) {
      return (btn.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "confirm & submit document";
    });
    if (!submit) return;

    submit.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var host = window.location && window.location.hostname ? window.location.hostname : "";
      var isLocal = host === "localhost" || host === "127.0.0.1";
      if (isLocal) {
        console.warn("[borrower-portal] Submit action not wired; no endpoint available.");
      }
    });
  }

  var data = getData() || {};
  var root = getRoot();
  if (!root) return;

  applyUploads(root, data.uploads || [], data.error || null);
  applyChecklist(root, data.checklist || { required: 0, received: 0, missing: 0, missingItems: [] });
  updateToolbarFilename(root, data.uploads || []);
  wireUploadBox(root, data);
  wireSubmitButton(root);

  if (data.error) {
    setUploadError(root, data.error);
  }
})();
`;
}
