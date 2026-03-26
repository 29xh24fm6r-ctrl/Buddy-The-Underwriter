import "server-only";

/**
 * Phase 56C — Closing Package Generation
 *
 * Assembles a versioned closing package from canonical deal data.
 * Uses template registry to determine supported document types.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { getDocsGenerationGate } from "./getDocsGenerationGate";

type GenerateInput = {
  dealId: string;
  bankId: string;
  actorUserId: string;
};

type GenerateResult = {
  ok: true;
  packageId: string;
  documentCount: number;
  status: string;
} | {
  ok: false;
  error: string;
  blockers?: string[];
};

/**
 * Generate a closing package for a deal.
 * Checks gate, creates package record, generates document stubs.
 */
export async function generateClosingPackage(input: GenerateInput): Promise<GenerateResult> {
  const { dealId, bankId, actorUserId } = input;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // 1. Gate check
  const gate = await getDocsGenerationGate(dealId);
  if (!gate.ready) {
    await logLedgerEvent({
      dealId, bankId,
      eventKey: "closing_package.generation_blocked",
      uiState: "done",
      uiMessage: "Closing package generation blocked",
      meta: { blockers: gate.blockerCodes, actor: actorUserId },
    }).catch(() => {});

    return { ok: false, error: "docs_not_ready", blockers: gate.blockerCodes };
  }

  try {
    // 2. Get latest version number
    const { data: existing } = await sb
      .from("closing_packages")
      .select("generation_version")
      .eq("deal_id", dealId)
      .order("generation_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newVersion = (existing?.generation_version ?? 0) + 1;

    // Supersede prior active package
    if (existing) {
      await sb
        .from("closing_packages")
        .update({ status: "superseded", updated_at: now })
        .eq("deal_id", dealId)
        .neq("status", "superseded");
    }

    // 3. Load template to determine docs
    const { data: template } = await sb
      .from("loan_doc_templates")
      .select("template_key, supported_features, product_type")
      .eq("template_key", gate.templateKey!)
      .maybeSingle();

    const features = (template?.supported_features ?? []) as string[];

    // 4. Create package record
    const { data: pkg, error: pkgErr } = await sb
      .from("closing_packages")
      .insert({
        deal_id: dealId,
        package_type: "loan_docs",
        product_type: template?.product_type ?? "unknown",
        status: "generated",
        generation_version: newVersion,
        generated_from_json: {
          templateKey: gate.templateKey,
          builderGateEvidence: gate.evidence,
        },
        document_count: features.length,
        generated_at: now,
        generated_by: actorUserId,
      })
      .select("id")
      .single();

    if (pkgErr || !pkg) throw new Error(pkgErr?.message ?? "Package insert failed");

    // 5. Create document stubs
    const docRows = features.map((feature) => ({
      closing_package_id: pkg.id,
      document_type: feature,
      title: humanizeDocType(feature),
      status: "generated",
    }));

    if (docRows.length > 0) {
      await sb.from("closing_package_documents").insert(docRows);
    }

    // 6. Create closing checklist items from template
    const checklistItems = buildDefaultChecklist(dealId, pkg.id, features);
    if (checklistItems.length > 0) {
      await sb.from("closing_checklist_items").insert(checklistItems);
    }

    // 7. Audit
    await logLedgerEvent({
      dealId, bankId,
      eventKey: "closing_package.generated",
      uiState: "done",
      uiMessage: `Closing package v${newVersion} generated`,
      meta: {
        package_id: pkg.id,
        version: newVersion,
        template_key: gate.templateKey,
        document_count: features.length,
        checklist_count: checklistItems.length,
        actor: actorUserId,
      },
    }).catch(() => {});

    return { ok: true, packageId: pkg.id, documentCount: features.length, status: "generated" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function humanizeDocType(feature: string): string {
  const map: Record<string, string> = {
    promissory_note: "Promissory Note",
    guaranty: "Guaranty Agreement",
    security_agreement: "Security Agreement",
    closing_checklist: "Closing Checklist",
    borrowing_base: "Borrowing Base Certificate",
    sba_note: "SBA Note",
    sba_guaranty: "SBA Guaranty",
    sba_authorization: "SBA Authorization",
    deed_of_trust: "Deed of Trust",
  };
  return map[feature] ?? feature.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildDefaultChecklist(dealId: string, packageId: string, features: string[]) {
  const items: Array<Record<string, unknown>> = [];

  // Signature items for each document
  for (const f of features) {
    if (f === "closing_checklist") continue;
    items.push({
      deal_id: dealId,
      closing_package_id: packageId,
      item_type: "document_signature",
      title: `Execute ${humanizeDocType(f)}`,
      required: true,
      status: "open",
      owner: "borrower",
    });
  }

  // Standard closing items
  items.push(
    { deal_id: dealId, closing_package_id: packageId, item_type: "insurance", title: "Provide proof of insurance", required: true, status: "open", owner: "borrower" },
    { deal_id: dealId, closing_package_id: packageId, item_type: "entity_certification", title: "Good standing certificate", required: true, status: "open", owner: "borrower" },
    { deal_id: dealId, closing_package_id: packageId, item_type: "legal_review", title: "Counsel review of loan documents", required: true, status: "open", owner: "counsel" },
    { deal_id: dealId, closing_package_id: packageId, item_type: "funding_condition", title: "Verify all conditions precedent satisfied", required: true, status: "open", owner: "banker" },
  );

  return items;
}
