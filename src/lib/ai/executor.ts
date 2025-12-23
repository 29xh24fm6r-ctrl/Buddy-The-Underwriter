import type { BuddyActionT } from "./schemas";
import {
  addCondition,
  createTask,
  flagRisk,
  generatePdf,
  requestDocument,
  setDealStatus,
  getOrCreateDeal,
} from "@/lib/db/deals";

export type ExecuteResult =
  | { ok: true; applied: true; message: string; data?: any }
  | { ok: false; applied: false; message: string; data?: any };

function requireString(x: any, label: string) {
  const s = String(x ?? "").trim();
  if (!s) throw new Error(`Missing required field: ${label}`);
  return s;
}

export async function executeAction(params: { dealId: string; action: BuddyActionT }): Promise<ExecuteResult> {
  const { dealId, action } = params;

  // Ensure deal exists (demo)
  getOrCreateDeal(dealId);

  try {
    switch (action.type) {
      case "REQUEST_DOCUMENT": {
        const docType = requireString(action.payload?.docType ?? action.payload?.type, "payload.docType");
        const note = action.payload?.note ? String(action.payload.note) : undefined;
        const d = requestDocument(dealId, docType, note);
        return { ok: true, applied: true, message: `Requested document: ${docType}`, data: d };
      }

      case "CREATE_TASK": {
        const title = requireString(action.payload?.title ?? action.title, "payload.title");
        const assignedTo = action.payload?.assignedTo ? String(action.payload.assignedTo) : undefined;
        const dueAt = action.payload?.dueAt ? String(action.payload.dueAt) : undefined;
        const t = createTask(dealId, title, assignedTo, dueAt);
        return { ok: true, applied: true, message: `Task created: ${title}`, data: t };
      }

      case "FLAG_RISK": {
        const title = requireString(action.payload?.title ?? action.title, "payload.title");
        const severityRaw = String(action.payload?.severity ?? "MED").toUpperCase();
        const severity = (["LOW", "MED", "HIGH"] as const).includes(severityRaw as any)
          ? (severityRaw as "LOW" | "MED" | "HIGH")
          : "MED";
        const r = flagRisk(dealId, title, severity);
        return { ok: true, applied: true, message: `Risk flagged (${severity}): ${title}`, data: r };
      }

      case "ADD_CONDITION": {
        const text = requireString(action.payload?.text ?? action.payload?.condition ?? action.title, "payload.text");
        const c = addCondition(dealId, text);
        return { ok: true, applied: true, message: `Condition added: ${text}`, data: c };
      }

      case "SET_DEAL_STATUS": {
        const status = requireString(action.payload?.status, "payload.status");
        const deal = setDealStatus(dealId, status);
        return { ok: true, applied: true, message: `Deal status set to ${status}`, data: deal };
      }

      case "GENERATE_PDF": {
        const template = requireString(action.payload?.template ?? "GENERIC", "payload.template");
        const data = (action.payload?.data && typeof action.payload.data === "object") ? action.payload.data : {};

        // Advanced memo path
        if (template === "CREDIT_MEMO_ADVANCED") {
          const dataObj = data as any;
          const memoHtml = requireString(dataObj?.memoHtml, "data.memoHtml");
          const memoVersion = String(dataObj?.memoVersion ?? "v1");

          // Render
          const { renderHtmlToPdf } = await import("@/lib/pdf/renderHtmlToPdf");
          const { filePath } = await renderHtmlToPdf({
            html: memoHtml,
            fileNamePrefix: `CREDIT_MEMO_${dealId}_${memoVersion}`.replaceAll("/", "_"),
          });

          // Store artifact
          const { savePdfArtifact } = await import("@/lib/db/pdfs");
          const artifact = savePdfArtifact({
            dealId,
            template,
            filePath,
            meta: {
              memoVersion,
            },
          });

          return {
            ok: true,
            applied: true,
            message: `PDF generated: Advanced Credit Memo (${memoVersion})`,
            data: {
              pdfId: artifact.id,
              url: `/api/pdfs/${artifact.id}`,
              filePath: artifact.filePath,
            },
          };
        }

        // Default stub
        const pdf = generatePdf(dealId, template, data);
        return { ok: true, applied: true, message: `PDF generated: ${template}`, data: pdf };
      }

      default:
        return { ok: false, applied: false, message: `Unsupported action type: ${action.type}` };
    }
  } catch (e: any) {
    return { ok: false, applied: false, message: e?.message ?? "Execution failed" };
  }
}
