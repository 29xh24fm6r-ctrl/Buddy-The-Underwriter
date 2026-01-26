/**
 * Mission Orchestrator
 *
 * Executes a complete research mission:
 * 1. Discover sources
 * 2. Ingest sources (fetch + store)
 * 3. Extract facts
 * 4. Derive inferences
 * 5. Compile narrative
 * 6. Persist everything to database
 *
 * This is the main entry point for running research missions.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ResearchMission,
  ResearchSource,
  ResearchFact,
  ResearchInference,
  MissionType,
  MissionSubject,
  MissionDepth,
  MissionExecutionResult,
  NarrativeSection,
} from "./types";
import { discoverSources } from "./sourceDiscovery";
import { ingestSources } from "./ingestSource";
import { extractFacts, extractFactsFromSources } from "./extractFacts";
import { deriveInferences, hasEnoughFactsForInferences } from "./deriveInferences";
import { compileNarrative } from "./compileNarrative";

/**
 * Create a new research mission in the database.
 */
async function createMission(
  dealId: string,
  missionType: MissionType,
  subject: MissionSubject,
  depth: MissionDepth,
  bankId?: string | null,
  userId?: string | null
): Promise<{ ok: boolean; missionId?: string; error?: string }> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("buddy_research_missions")
    .insert({
      deal_id: dealId,
      bank_id: bankId ?? null,
      mission_type: missionType,
      subject,
      depth,
      status: "queued",
      created_by: userId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, missionId: data.id };
}

/**
 * Update mission status.
 */
async function updateMissionStatus(
  missionId: string,
  status: "running" | "complete" | "failed" | "cancelled",
  errorMessage?: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const updates: Record<string, unknown> = { status };

  if (status === "running") {
    updates.started_at = new Date().toISOString();
  } else if (status === "complete" || status === "failed") {
    updates.completed_at = new Date().toISOString();
  }

  if (errorMessage) {
    updates.error_message = errorMessage;
  }

  await supabase
    .from("buddy_research_missions")
    .update(updates)
    .eq("id", missionId);
}

/**
 * Persist sources to the database.
 */
async function persistSources(
  sources: Omit<ResearchSource, "id">[]
): Promise<{ ok: boolean; sources: ResearchSource[]; error?: string }> {
  if (sources.length === 0) {
    return { ok: true, sources: [] };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("buddy_research_sources")
    .insert(
      sources.map((s) => ({
        mission_id: s.mission_id,
        source_class: s.source_class,
        source_name: s.source_name,
        source_url: s.source_url,
        raw_content: s.raw_content,
        content_type: s.content_type,
        checksum: s.checksum,
        retrieved_at: s.retrieved_at,
        http_status: s.http_status,
        fetch_duration_ms: s.fetch_duration_ms,
        fetch_error: s.fetch_error,
      }))
    )
    .select("*");

  if (error) {
    return { ok: false, sources: [], error: error.message };
  }

  return { ok: true, sources: data as ResearchSource[] };
}

/**
 * Persist facts to the database.
 */
async function persistFacts(
  missionId: string,
  facts: Array<Omit<ResearchFact, "id" | "mission_id" | "extracted_at">>
): Promise<{ ok: boolean; facts: ResearchFact[]; error?: string }> {
  if (facts.length === 0) {
    return { ok: true, facts: [] };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("buddy_research_facts")
    .insert(
      facts.map((f) => ({
        mission_id: missionId,
        source_id: f.source_id,
        fact_type: f.fact_type,
        value: f.value,
        confidence: f.confidence,
        extracted_by: f.extracted_by,
        extraction_path: f.extraction_path,
        as_of_date: f.as_of_date,
      }))
    )
    .select("*");

  if (error) {
    return { ok: false, facts: [], error: error.message };
  }

  return { ok: true, facts: data as ResearchFact[] };
}

/**
 * Persist inferences to the database.
 */
async function persistInferences(
  missionId: string,
  inferences: Array<Omit<ResearchInference, "id" | "mission_id" | "created_at">>
): Promise<{ ok: boolean; inferences: ResearchInference[]; error?: string }> {
  if (inferences.length === 0) {
    return { ok: true, inferences: [] };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("buddy_research_inferences")
    .insert(
      inferences.map((i) => ({
        mission_id: missionId,
        inference_type: i.inference_type,
        conclusion: i.conclusion,
        input_fact_ids: i.input_fact_ids,
        confidence: i.confidence,
        reasoning: i.reasoning,
      }))
    )
    .select("*");

  if (error) {
    return { ok: false, inferences: [], error: error.message };
  }

  return { ok: true, inferences: data as ResearchInference[] };
}

/**
 * Persist narrative to the database.
 */
async function persistNarrative(
  missionId: string,
  sections: NarrativeSection[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("buddy_research_narratives")
    .upsert({
      mission_id: missionId,
      sections,
      version: 1,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Execute a complete research mission.
 *
 * This is the main entry point for running Mission 001: Industry + Competitive Landscape.
 */
export async function runMission(
  dealId: string,
  missionType: MissionType,
  subject: MissionSubject,
  opts?: {
    depth?: MissionDepth;
    bankId?: string | null;
    userId?: string | null;
  }
): Promise<MissionExecutionResult> {
  const startTime = Date.now();
  const depth = opts?.depth ?? "overview";

  // 1. Create mission record
  const createResult = await createMission(
    dealId,
    missionType,
    subject,
    depth,
    opts?.bankId,
    opts?.userId
  );

  if (!createResult.ok || !createResult.missionId) {
    return {
      ok: false,
      mission_id: "",
      sources_count: 0,
      facts_count: 0,
      inferences_count: 0,
      narrative_sections: 0,
      error: createResult.error ?? "Failed to create mission",
      duration_ms: Date.now() - startTime,
    };
  }

  const missionId = createResult.missionId;

  try {
    // 2. Mark mission as running
    await updateMissionStatus(missionId, "running");

    // 3. Discover sources
    const discovered = discoverSources(missionType, subject);
    if (discovered.length === 0) {
      await updateMissionStatus(missionId, "failed", "No sources discovered for this subject");
      return {
        ok: false,
        mission_id: missionId,
        sources_count: 0,
        facts_count: 0,
        inferences_count: 0,
        narrative_sections: 0,
        error: "No sources discovered for this subject",
        duration_ms: Date.now() - startTime,
      };
    }

    // 4. Ingest sources
    const ingestionResults = await ingestSources(missionId, discovered, {
      concurrency: 3,
      timeoutMs: 30_000,
    });

    // 5. Persist sources (even failed ones for audit)
    const sourcesToPersist = ingestionResults.map((r) => ({
      ...r.source!,
      mission_id: missionId,
    }));

    const persistedSourcesResult = await persistSources(sourcesToPersist);
    if (!persistedSourcesResult.ok) {
      await updateMissionStatus(missionId, "failed", `Failed to persist sources: ${persistedSourcesResult.error}`);
      return {
        ok: false,
        mission_id: missionId,
        sources_count: 0,
        facts_count: 0,
        inferences_count: 0,
        narrative_sections: 0,
        error: persistedSourcesResult.error,
        duration_ms: Date.now() - startTime,
      };
    }

    const persistedSources = persistedSourcesResult.sources;

    // 6. Extract facts from successfully ingested sources
    const successfulSources = persistedSources.filter(
      (s) => s.fetch_error === null && s.raw_content !== null
    );

    const extractedFacts = extractFactsFromSources(successfulSources);

    // 7. Persist facts
    const persistedFactsResult = await persistFacts(missionId, extractedFacts);
    if (!persistedFactsResult.ok) {
      await updateMissionStatus(missionId, "failed", `Failed to persist facts: ${persistedFactsResult.error}`);
      return {
        ok: false,
        mission_id: missionId,
        sources_count: persistedSources.length,
        facts_count: 0,
        inferences_count: 0,
        narrative_sections: 0,
        error: persistedFactsResult.error,
        duration_ms: Date.now() - startTime,
      };
    }

    const persistedFacts = persistedFactsResult.facts;

    // 8. Derive inferences
    let persistedInferences: ResearchInference[] = [];
    if (hasEnoughFactsForInferences(persistedFacts)) {
      const derivedInferences = deriveInferences(persistedFacts);

      // 9. Persist inferences
      const persistedInferencesResult = await persistInferences(missionId, derivedInferences.inferences);
      if (!persistedInferencesResult.ok) {
        // Non-fatal: we can still complete the mission without inferences
        console.warn(`Failed to persist inferences: ${persistedInferencesResult.error}`);
      } else {
        persistedInferences = persistedInferencesResult.inferences;
      }
    }

    // 10. Compile narrative
    const narrativeResult = compileNarrative(persistedFacts, persistedInferences, persistedSources);

    // 11. Persist narrative
    if (narrativeResult.ok && narrativeResult.sections.length > 0) {
      const narrativePersistResult = await persistNarrative(missionId, narrativeResult.sections);
      if (!narrativePersistResult.ok) {
        // Non-fatal: mission is still successful
        console.warn(`Failed to persist narrative: ${narrativePersistResult.error}`);
      }
    }

    // 12. Mark mission as complete
    await updateMissionStatus(missionId, "complete");

    return {
      ok: true,
      mission_id: missionId,
      sources_count: persistedSources.length,
      facts_count: persistedFacts.length,
      inferences_count: persistedInferences.length,
      narrative_sections: narrativeResult.sections.length,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    // Mark mission as failed
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await updateMissionStatus(missionId, "failed", errorMessage);

    return {
      ok: false,
      mission_id: missionId,
      sources_count: 0,
      facts_count: 0,
      inferences_count: 0,
      narrative_sections: 0,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Convenience function for Mission 001: Industry + Competitive Landscape
 */
export async function runIndustryLandscapeMission(
  dealId: string,
  naicsCode: string,
  opts?: {
    geography?: string;
    depth?: MissionDepth;
    bankId?: string | null;
    userId?: string | null;
  }
): Promise<MissionExecutionResult> {
  return runMission(dealId, "industry_landscape", {
    naics_code: naicsCode,
    geography: opts?.geography ?? "US",
  }, opts);
}
