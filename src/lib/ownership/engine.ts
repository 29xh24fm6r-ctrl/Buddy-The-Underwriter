// src/lib/ownership/engine.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveOwnerRequirementsFromPct } from "./rules";
import { recordAiEvent } from "@/lib/ai/audit";
import { aiJson } from "@/lib/ai/openai";
import { sanitizeEntityName } from "@/lib/ownership/sanitizeEntityName";

function nowIso() { return new Date().toISOString(); }

export async function computeOwnershipFromDiscovery(dealId: string) {
  const sb = supabaseAdmin();

  // Pull any ownership-related facts/answers
  const facts = await sb.from("credit_discovery_facts").select("*").eq("deal_id", dealId).eq("domain", "ownership");
  if (facts.error) throw facts.error;

  const ownershipText = facts.data?.map((f: any) => JSON.stringify(f.value_json)).join("\n") || "";

  const schemaHint = `{
    "entities":[{"temp_id":"o1","entity_type":"person","display_name":"string","confidence":60}],
    "edges":[{"from_temp_id":"o1","to_temp_id":"borrower","relationship":"owns","ownership_pct":50.0,"confidence":60}],
    "notes":"string"
  }`;

  const ai = await aiJson<any>({
    scope: "ownership",
    action: "extract_ownership",
    system:
      "You are a senior SBA/commercial loan underwriter. Extract ownership entities and ownership percentages. Do not invent percentages. If unclear, omit pct and lower confidence.",
    user: `INPUT (ownership evidence):\n${ownershipText}\nReturn JSON exactly matching schema.`,
    jsonSchemaHint: schemaHint,
  });

  await recordAiEvent({
    deal_id: dealId,
    scope: "ownership",
    action: "extract_ownership",
    input_json: { dealId, ownershipTextLen: ownershipText.length },
    output_json: ai.ok ? ai.result : { error: ai.error },
    confidence: ai.ok ? ai.confidence : null,
    evidence_json: facts.data || null,
    requires_human_review: true,
  });

  // Deterministic fallback: if AI stub returns empty, create nothing
  const entities = ai.ok && Array.isArray(ai.result?.entities) ? ai.result.entities : [];
  const edges = ai.ok && Array.isArray(ai.result?.edges) ? ai.result.edges : [];

  // Create a canonical "borrower" node each run (idempotent-ish: find existing by display_name)
  let borrowerEntityId: string | null = null;
  {
    const existingBorrower = await sb.from("ownership_entities")
      .select("*")
      .eq("deal_id", dealId)
      .eq("entity_type", "company")
      .eq("display_name", "Borrower")
      .maybeSingle();
    if (existingBorrower.error) throw existingBorrower.error;

    if (existingBorrower.data) {
      borrowerEntityId = existingBorrower.data.id;
    } else {
      const ins = await sb.from("ownership_entities").insert({
        deal_id: dealId,
        entity_type: "company",
        display_name: "Borrower",
        confidence: 100,
        meta_json: { role: "borrower_root" },
        evidence_json: [{ kind: "system" }],
      }).select("*").single();
      if (ins.error) throw ins.error;
      borrowerEntityId = ins.data.id;
    }
  }

  // Map temp ids -> db ids
  const tempToDb = new Map<string, string>();
  for (const e of entities) {
    if (!e?.temp_id || !e?.display_name) continue;

    // Sanitize to strip PDF/OCR label-bleed garbage before writing or
    // lookup (STUCK-SPREADS Batch 2, 2026-04-23).
    const cleanName = sanitizeEntityName(e.display_name);
    if (!cleanName) continue;

    // try to match by name
    const found = await sb.from("ownership_entities")
      .select("*")
      .eq("deal_id", dealId)
      .eq("entity_type", e.entity_type || "person")
      .eq("display_name", cleanName)
      .maybeSingle();
    if (found.error) throw found.error;

    let id = found.data?.id;
    if (!id) {
      const ins = await sb.from("ownership_entities").insert({
        deal_id: dealId,
        entity_type: e.entity_type || "person",
        display_name: cleanName,
        confidence: Number(e.confidence ?? 50),
        meta_json: e.meta_json ?? {},
        evidence_json: [{ kind: "ai_extracted" }],
      }).select("*").single();
      if (ins.error) throw ins.error;
      id = ins.data.id;
    }
    tempToDb.set(String(e.temp_id), id);
  }

  // Insert edges
  for (const ed of edges) {
    const fromTemp = String(ed.from_temp_id || "");
    const toTemp = String(ed.to_temp_id || "");

    const fromId = tempToDb.get(fromTemp);
    const toId = (toTemp === "borrower") ? borrowerEntityId : tempToDb.get(toTemp);

    if (!fromId || !toId) continue;

    const pct = ed.ownership_pct != null ? Number(ed.ownership_pct) : null;

    const insEdge = await sb.from("ownership_edges").insert({
      deal_id: dealId,
      from_entity_id: fromId,
      to_entity_id: toId,
      relationship: ed.relationship || "owns",
      ownership_pct: pct,
      confidence: Number(ed.confidence ?? 50),
      evidence_json: [{ kind: "ai_extracted" }],
    });
    if (insEdge.error) {
      // ignore duplicates for v1 (you can add unique constraints later)
    }

    // Derive requirements if pct >=20 and from is person owner
    if (pct != null && pct >= 20) {
      const req = deriveOwnerRequirementsFromPct(pct);
      if (req.length) {
        // owner_requirements.owner_entity_id FKs to deal_ownership_entities (NOT ownership_entities).
        // threshold_basis CHECK constraint: 'sba_20pct' | 'bank_policy' | 'exception'
        const entityRecord = entities.find((e: any) => tempToDb.get(String(e.temp_id)) === fromId);
        const cleanName = entityRecord?.display_name
          ? (sanitizeEntityName(entityRecord.display_name) ?? entityRecord.display_name)
          : null;

        if (cleanName) {
          // Find or create the deal_ownership_entities row
          let doeId: string | null = null;

          const doeFound = await sb
            .from("deal_ownership_entities")
            .select("id")
            .eq("deal_id", dealId)
            .eq("display_name", cleanName)
            .maybeSingle();

          if (!doeFound.error && doeFound.data) {
            doeId = doeFound.data.id;
          } else if (!doeFound.error) {
            const doeIns = await sb
              .from("deal_ownership_entities")
              .insert({
                deal_id: dealId,
                entity_type: "person",
                display_name: cleanName,
              })
              .select("id")
              .single();
            if (!doeIns.error) doeId = doeIns.data.id;
          }

          if (doeId) {
            const thresholdBasis: "sba_20pct" | "bank_policy" = pct >= 20 ? "sba_20pct" : "bank_policy";
            await sb.from("owner_requirements").upsert({
              deal_id: dealId,
              owner_entity_id: doeId,
              threshold_basis: thresholdBasis,
              required_items: req,
              status_json: { state: "open", derived_from: { ownership_pct: pct } },
              updated_at: nowIso(),
            }, { onConflict: "deal_id,owner_entity_id" });
          }
          // Non-fatal: if DOE row can't be created, skip requirements — ownership graph still written
        }
      }
    }
  }

  // Return graph
  const ents = await sb.from("ownership_entities").select("*").eq("deal_id", dealId);
  if (ents.error) throw ents.error;

  const e2 = await sb.from("ownership_edges").select("*").eq("deal_id", dealId);
  if (e2.error) throw e2.error;

  const reqs = await sb.from("owner_requirements").select("*").eq("deal_id", dealId);
  if (reqs.error) throw reqs.error;

  return { entities: ents.data || [], edges: e2.data || [], requirements: reqs.data || [] };
}
