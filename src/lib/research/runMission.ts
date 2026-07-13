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

import { supabaseAdmin } from "@/lib/supabase/admin";
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
import { generateRunKey, checkExistingMission } from "./orchestration";
import { saveCheckpoint, getResumeDecision, type CheckpointStage } from "./checkpoint";
import { createThreadRun, completeThreadRun, failThreadRun } from "./threadRuns";
import { recordFailure, getActiveCooldownDomains, mapBIEErrorTypeToFailureCategory, classifyFailure } from "./failureLibrary";
import type { BIECachedThreadResult, BIEThreadName, BIEResult } from "./buddyIntelligenceEngine";

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Create a new research mission in the database.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1 — idempotency): this
 * previously never set `run_key`, so the unique index on
 * (deal_id, run_key) WHERE status IN ('queued','running','complete')
 * (buddy_research_missions_run_key_active_idx) was entirely inert — every
 * trigger created a brand-new mission, including a full duplicate 8-thread
 * BIE pass if two requests raced. It now sets a deterministic run_key and
 * relies on the DB unique constraint as the race-safe backstop (the caller
 * should also call checkExistingMission() first as a fast, non-racy path).
 */
async function createMission(
  dealId: string,
  missionType: MissionType,
  subject: MissionSubject,
  depth: MissionDepth,
  bankId?: string | null,
  userId?: string | null,
  runKey?: string
): Promise<{ ok: boolean; missionId?: string; error?: string; duplicate?: boolean }> {
  const supabase = supabaseAdmin();

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
      run_key: runKey ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Postgres unique_violation — another request won the race and already
    // created (or completed) a mission with this exact run_key. Look it up
    // and return it instead of failing the caller.
    if (error.code === "23505" && runKey) {
      const { data: existing } = await supabase
        .from("buddy_research_missions")
        .select("id")
        .eq("deal_id", dealId)
        .eq("run_key", runKey)
        .in("status", ["queued", "running", "complete"])
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        console.warn(`[runMission] createMission: duplicate run_key race — reusing existing mission ${existing.id}`);
        return { ok: true, missionId: existing.id, duplicate: true };
      }
    }
    console.error("[runMission] createMission DB error:", error.message, error.code, error.details, error.hint);
    return { ok: false, error: error.message };
  }

  if (!data?.id) {
    console.error("[runMission] createMission: insert succeeded but no id returned");
    return { ok: false, error: "mission_insert_no_id" };
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
  const supabase = supabaseAdmin();

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
 * Write an unconditional degraded quality-gate row.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): a BIE crash or a
 * trust-layer (claim ledger / completion gate) crash previously left the
 * mission at status="complete" with NO buddy_research_quality_gates row at
 * all — indistinguishable in the UI/DB from a genuinely un-gated mission
 * except by the *absence* of a row. This mirrors the existing subject-lock
 * failure write (below) so every terminal BIE/trust-layer failure leaves an
 * explicit, queryable "gate_passed=false" record rather than silence. Never
 * throws — a diagnostic write must not itself become a new failure mode.
 */
export async function writeDegradedQualityGate(
  missionId: string,
  dealId: string,
  gateId: string,
  reason: string
): Promise<void> {
  try {
    const sb = supabaseAdmin();
    await (sb as any).from("buddy_research_quality_gates").upsert(
      {
        mission_id: missionId,
        deal_id: dealId,
        trust_grade: "manual_review_required",
        gate_passed: false,
        quality_score: 0,
        gate_failures: [{ gate_id: gateId, reason }],
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "mission_id" },
    );
  } catch (e: any) {
    console.warn(`[runMission] writeDegradedQualityGate failed for ${gateId} (non-fatal):`, e?.message);
  }

  // External alerting (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — round 5,
  // corrected post-merge: targets Chatto, not Slack — Buddy's internal
  // comms tool is Chatto): every degraded-quality-gate write is a genuine
  // mission-level failure signal, so this is the single natural point to
  // push an external alert from, without scattering alert calls across
  // every catch block that already calls writeDegradedQualityGate. No-ops
  // safely if CHATTO_WEBHOOK_URL isn't configured — see researchAlerts.ts.
  try {
    const { sendResearchCriticalAlert } = await import("./researchAlerts");
    await sendResearchCriticalAlert({ missionId, dealId, gateId, reason });
  } catch (e: any) {
    console.warn(`[runMission] sendResearchCriticalAlert failed for ${gateId} (non-fatal):`, e?.message);
  }
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

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("buddy_research_sources")
    .insert(
      sources.map((s) => ({
        mission_id: s.mission_id,
        source_class: s.source_class,
        source_name: s.source_name,
        source_url: s.source_url,
        raw_content: s.raw_content ?? null,
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

  const supabase = supabaseAdmin();

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

  const supabase = supabaseAdmin();

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
  const supabase = supabaseAdmin();

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

// ============================================================================
// Resumable missions + failure learning
// (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — round 4)
// ============================================================================

/**
 * Find the most recent FAILED mission for this exact (deal_id, run_key).
 *
 * checkExistingMission() deliberately only matches queued/running/complete —
 * a failed mission is invisible to it, so retrying a failed run_key
 * previously always created a brand-new mission from scratch. This is the
 * other half: when found (and forceRerun wasn't requested), the caller
 * reuses this mission's id and checkpoints instead of starting over.
 */
async function findFailedMissionForRunKey(
  dealId: string,
  runKey: string,
): Promise<{ id: string; attempt_count: number } | null> {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("buddy_research_missions")
    .select("id, attempt_count")
    .eq("deal_id", dealId)
    .eq("run_key", runKey)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id, attempt_count: data.attempt_count ?? 1 } : null;
}

/** Transition a previously-failed mission row back to running for a retry. */
async function resumeFailedMission(missionId: string, previousAttemptCount: number): Promise<void> {
  const supabase = supabaseAdmin();
  await supabase
    .from("buddy_research_missions")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
      attempt_count: previousAttemptCount + 1,
    })
    .eq("id", missionId);
}

async function loadPersistedSources(missionId: string): Promise<ResearchSource[]> {
  const { data } = await supabaseAdmin()
    .from("buddy_research_sources")
    .select("*")
    .eq("mission_id", missionId);
  return (data ?? []) as ResearchSource[];
}

async function loadPersistedFacts(missionId: string): Promise<ResearchFact[]> {
  const { data } = await supabaseAdmin()
    .from("buddy_research_facts")
    .select("*")
    .eq("mission_id", missionId);
  return (data ?? []) as ResearchFact[];
}

async function loadPersistedInferences(missionId: string): Promise<ResearchInference[]> {
  const { data } = await supabaseAdmin()
    .from("buddy_research_inferences")
    .select("*")
    .eq("mission_id", missionId);
  return (data ?? []) as ResearchInference[];
}

/**
 * Checkpoint state persisted for the "bie_enrichment" stage.
 *
 * Saved TWICE per BIE run: once immediately after runBuddyIntelligenceEngine()
 * returns (gate_and_claims_persisted: false — so a per-thread result is
 * durable even if a later step in the same block throws), and again after
 * the hallucination guard / narrative upsert / claim ledger / completion
 * gate all finish successfully (gate_and_claims_persisted: true — signals a
 * resume can skip the whole block, not just reuse thread results).
 */
type BieCheckpointState = {
  thread_results: Partial<Record<BIEThreadName, BIECachedThreadResult>>;
  gate_and_claims_persisted: boolean;
};

async function saveBieCheckpoint(
  missionId: string,
  threadResults: Partial<Record<BIEThreadName, BIECachedThreadResult>>,
  gateAndClaimsPersisted: boolean,
): Promise<void> {
  try {
    const state: BieCheckpointState = { thread_results: threadResults, gate_and_claims_persisted: gateAndClaimsPersisted };
    await saveCheckpoint(supabaseAdmin(), {
      mission_id: missionId,
      stage: "bie_enrichment",
      state_json: state as unknown as Record<string, unknown>,
    });
  } catch (e: any) {
    console.warn("[runMission] bie_enrichment checkpoint save failed (non-fatal):", e?.message);
  }
}

async function loadLatestBieCheckpointState(missionId: string): Promise<BieCheckpointState | null> {
  const { data } = await supabaseAdmin()
    .from("buddy_research_checkpoints")
    .select("state_json")
    .eq("mission_id", missionId)
    .eq("stage", "bie_enrichment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.state_json as BieCheckpointState | undefined) ?? null;
}

/** Pull each thread's raw output out of a BIEResult, for checkpointing. */
export function extractBieThreadResults(bieResult: BIEResult): Partial<Record<BIEThreadName, BIECachedThreadResult>> {
  const ts = bieResult.thread_sources;
  const tseg = bieResult.thread_segments;
  const td = bieResult.thread_diagnostics;
  return {
    entity_lock: { result: bieResult.entity_lock, sourceUrls: ts.entity_lock, segments: tseg.entity_lock, diagnostic: td.entity_lock },
    borrower: { result: bieResult.borrower, sourceUrls: ts.borrower, segments: tseg.borrower, diagnostic: td.borrower },
    management: { result: bieResult.management, sourceUrls: ts.management, segments: tseg.management, diagnostic: td.management },
    competitive: { result: bieResult.competitive, sourceUrls: ts.competitive, segments: tseg.competitive, diagnostic: td.competitive },
    market: { result: bieResult.market, sourceUrls: ts.market, segments: tseg.market, diagnostic: td.market },
    industry: { result: bieResult.industry, sourceUrls: ts.industry, segments: tseg.industry, diagnostic: td.industry },
    transaction: { result: bieResult.transaction, sourceUrls: ts.transaction, segments: tseg.transaction, diagnostic: td.transaction },
    // Synthesis has no external sources of its own (derived from the other threads).
    synthesis: { result: bieResult.synthesis, sourceUrls: [], segments: [], diagnostic: td.synthesis },
  };
}

/** Record a failure for every non-ok BIE thread ("learn" — round 4). */
async function recordBieThreadFailures(missionId: string, missionType: MissionType, bieResult: BIEResult): Promise<void> {
  const sb = supabaseAdmin();
  for (const [threadName, diag] of Object.entries(bieResult.thread_diagnostics) as Array<
    [string, BIEResult["thread_diagnostics"][keyof BIEResult["thread_diagnostics"]]]
  >) {
    // fallback_used and skipped are intentional, expected outcomes, not failures.
    if (diag.ok || diag.error_type === "fallback_used" || diag.error_type === "skipped") continue;
    const category = mapBIEErrorTypeToFailureCategory(diag.error_type, diag.http_status, diag.json_parse_error);
    await recordFailure(sb, {
      error: `${threadName}:${diag.error_type}${diag.json_parse_error ? ` — ${diag.json_parse_error}` : ""}`,
      mission_id: missionId,
      mission_type: missionType,
      category,
      auto_retryable: category === "rate_limited" || category === "source_unavailable" || category === "timeout",
      cooldown_seconds: category === "rate_limited" ? 900 : undefined,
    }).catch((e: any) => console.warn(`[runMission] recordFailure (BIE thread ${threadName}) failed (non-fatal):`, e?.message));
  }
}

/** Save a small-summary checkpoint for a legacy-pipeline stage (best-effort). */
async function checkpointStage(
  missionId: string,
  stage: CheckpointStage,
  summary: Record<string, unknown>,
): Promise<void> {
  try {
    await saveCheckpoint(supabaseAdmin(), { mission_id: missionId, stage, state_json: summary });
  } catch (e: any) {
    console.warn(`[runMission] checkpoint save failed for stage ${stage} (non-fatal):`, e?.message);
  }
}

/** Track a stage's execution in buddy_research_thread_runs (best-effort, never blocks the mission). */
async function trackStage<T>(
  missionId: string,
  stage: CheckpointStage,
  fn: () => Promise<T>,
): Promise<T> {
  const sb = supabaseAdmin();
  const threadRunId = await createThreadRun(sb, missionId, stage).catch(() => null);
  try {
    const result = await fn();
    if (threadRunId) await completeThreadRun(sb, threadRunId, { items_processed: 1 }).catch(() => {});
    return result;
  } catch (err: unknown) {
    if (threadRunId) {
      const error = err instanceof Error ? err : new Error(String(err));
      await failThreadRun(sb, threadRunId, { message: error.message }).catch(() => {});
    }
    throw err;
  }
}

/**
 * Manual thread-run start/end helpers for stages with early-return exit
 * points inline in runMission()'s own control flow, where wrapping the
 * whole stage in trackStage()'s closure isn't possible without turning an
 * early `return` from runMission() into a thrown exception purely for
 * tracking purposes. Best-effort, like every other threadRuns.ts call.
 */
async function beginStageTracking(missionId: string, stage: CheckpointStage): Promise<string | null> {
  return createThreadRun(supabaseAdmin(), missionId, stage).catch(() => null);
}
async function endStageTracking(threadRunId: string | null, itemsProcessed: number): Promise<void> {
  if (!threadRunId) return;
  await completeThreadRun(supabaseAdmin(), threadRunId, { items_processed: itemsProcessed }).catch(() => {});
}
async function failStageTracking(threadRunId: string | null, message: string): Promise<void> {
  if (!threadRunId) return;
  await failThreadRun(supabaseAdmin(), threadRunId, { message }).catch(() => {});
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
    /** Bypass the run_key idempotency check (explicit "re-run" action). */
    forceRerun?: boolean;
  }
): Promise<MissionExecutionResult> {
  const startTime = Date.now();
  const depth = opts?.depth ?? "overview";

  // Idempotency (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): a
  // deterministic run_key means identical (deal_id, mission_type, subject,
  // depth) requests reuse an existing queued/running/complete mission
  // instead of spinning up a brand-new one — including a full duplicate
  // 8-thread BIE pass — every time. checkExistingMission() is the fast,
  // non-racy path; createMission()'s unique-constraint handling below is the
  // race-safe backstop for concurrent requests that both pass this check.
  const runKey = generateRunKey({ deal_id: dealId, mission_type: missionType, subject, depth });

  // GOVERNANCE (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): the AI Use
  // Case Registry's "restricted" designation was previously enforced only on
  // the autonomous planner's execution path (runPlanner.ts) — any direct
  // caller (POST /api/deals/[dealId]/research/run, POST /api/research/start)
  // could execute a mission type the registry marks restricted. Enforcing the
  // hard block here means every entry point gets it. We deliberately do NOT
  // enforce the softer "requires_approval" (human_in_loop / pending_review)
  // semantics here — those exist for the planner's proactive auto-triggering
  // model; a banker manually invoking "Run Research" already IS the human
  // approval for that entry point.
  try {
    const { checkMissionGovernance } = await import("./governance/useCaseRegistry");
    const governance = await checkMissionGovernance(missionType);
    if (!governance.allowed) {
      console.warn(`[runMission] Blocked by governance: ${governance.reason}`);
      return {
        ok: false,
        mission_id: "",
        sources_count: 0,
        facts_count: 0,
        inferences_count: 0,
        narrative_sections: 0,
        error: `governance_blocked: ${governance.reason}`,
        duration_ms: Date.now() - startTime,
      };
    }
  } catch (e: any) {
    // Governance check failure must never silently allow a restricted
    // mission through — but must also never permanently wedge legitimate
    // research if the registry table/lookup itself is unavailable. Log
    // loudly and fail open, matching checkExistingMission's documented
    // fail-open posture for the same class of infrastructure failure.
    console.warn("[runMission] governance check failed (failing open):", e?.message);
  }

  if (!opts?.forceRerun) {
    const existingCheck = await checkExistingMission(supabaseAdmin(), dealId, runKey, false);
    if (existingCheck.skip && existingCheck.existingMissionId) {
      const { data: existingMission } = await supabaseAdmin()
        .from("buddy_research_missions")
        .select("sources_count, facts_count, inferences_count")
        .eq("id", existingCheck.existingMissionId)
        .maybeSingle();
      console.log(`[runMission] Reusing existing mission ${existingCheck.existingMissionId} for run_key ${runKey} (idempotent — no new mission created)`);
      return {
        ok: true,
        mission_id: existingCheck.existingMissionId,
        sources_count: existingMission?.sources_count ?? 0,
        facts_count: existingMission?.facts_count ?? 0,
        inferences_count: existingMission?.inferences_count ?? 0,
        narrative_sections: 0,
        duration_ms: Date.now() - startTime,
        duplicate: true,
      };
    }
  }

  // Resumable missions (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — round 4):
  // checkExistingMission() above deliberately only matches
  // queued/running/complete — a FAILED mission for this exact run_key is
  // invisible to it, so a retry previously always created a brand-new
  // mission and redid every stage from scratch, including a full duplicate
  // 8-thread BIE pass even for threads that had already succeeded. When a
  // failed mission for this run_key exists (and the caller didn't force a
  // fresh run), reuse its id and checkpoints instead.
  let missionId: string;
  let resumeCompletedStages = new Set<CheckpointStage>();

  const failedMission = opts?.forceRerun ? null : await findFailedMissionForRunKey(dealId, runKey);

  if (failedMission) {
    await resumeFailedMission(failedMission.id, failedMission.attempt_count);
    missionId = failedMission.id;
    const decision = await getResumeDecision(supabaseAdmin(), missionId);
    resumeCompletedStages = new Set(decision.completedStages);
    console.log(
      `[runMission] Resuming previously-failed mission ${missionId} for run_key ${runKey} ` +
      `(attempt ${failedMission.attempt_count + 1}); completed stages: [${decision.completedStages.join(", ") || "none"}]`,
    );
  } else {
    // 1. Create mission record
    const createResult = await createMission(
      dealId,
      missionType,
      subject,
      depth,
      opts?.bankId,
      opts?.userId,
      runKey
    );

    if (createResult.duplicate && createResult.missionId) {
      return {
        ok: true,
        mission_id: createResult.missionId,
        sources_count: 0,
        facts_count: 0,
        inferences_count: 0,
        narrative_sections: 0,
        duration_ms: Date.now() - startTime,
        duplicate: true,
      };
    }

    if (!createResult.ok || !createResult.missionId) {
      console.error("[runMission] createMission failed:", createResult.error);
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

    missionId = createResult.missionId;
  }

  const completed = resumeCompletedStages;

  try {
    // 2. Mark mission as running
    await updateMissionStatus(missionId, "running");

    // 3–5. Discover, ingest, persist sources — skipped + reloaded from the
    // canonical table when a resumed mission already completed this stage
    // (persistSources() is a plain insert, not an upsert, so re-running
    // this stage on resume would silently duplicate every source row).
    let persistedSources: ResearchSource[];
    if (completed.has("source_ingestion")) {
      persistedSources = await loadPersistedSources(missionId);
      console.log(`[runMission] Resume: reused ${persistedSources.length} previously-ingested source(s), skipping discovery/ingestion`);
    } else {
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
      await checkpointStage(missionId, "source_discovery", { discovered_count: discovered.length });

      // Cooldown filtering (round 4, "learn from failure"): skip domains
      // that recently failed with a rate-limit/unavailable pattern instead
      // of wasting another network call chasing a known-dead source. Still
      // persisted below (as an explained skip, not a silent gap).
      const cooldownDomains = await getActiveCooldownDomains(supabaseAdmin()).catch((e: any) => {
        console.warn("[runMission] cooldown domain lookup failed (non-fatal, proceeding without it):", e?.message);
        return new Set<string>();
      });
      const inCooldown = (url: string) => {
        const host = safeHostname(url);
        return !!host && cooldownDomains.has(host);
      };
      const toIngest = discovered.filter((d) => !inCooldown(d.url));
      const cooldownSkipped = discovered.filter((d) => inCooldown(d.url));
      if (cooldownSkipped.length > 0) {
        console.log(
          `[runMission] Skipping ${cooldownSkipped.length} source(s) whose domain is in cooldown from recent failures: ` +
          cooldownSkipped.map((d) => safeHostname(d.url)).join(", "),
        );
      }

      // 4. Ingest sources
      const ingestionResults = await trackStage(missionId, "source_ingestion", () =>
        ingestSources(missionId, toIngest, { concurrency: 3, timeoutMs: 30_000 }),
      );
      const cooldownResults = cooldownSkipped.map((d) => ({
        ok: false,
        source: {
          id: "",
          mission_id: missionId,
          source_class: d.source_class,
          source_name: d.source_name,
          source_url: d.url,
          raw_content: null as unknown,
          content_type: null,
          checksum: "",
          retrieved_at: new Date().toISOString(),
          http_status: null,
          fetch_duration_ms: 0,
          fetch_error: `domain_in_cooldown: ${safeHostname(d.url) ?? "unknown"}`,
        } as ResearchSource,
        error: "domain_in_cooldown",
      }));

      // 5. Persist sources (even failed ones for audit)
      const sourcesToPersist = [...ingestionResults, ...cooldownResults].map((r) => ({
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

      persistedSources = persistedSourcesResult.sources;
      await checkpointStage(missionId, "source_ingestion", { persisted_count: persistedSources.length });

      // Learn from real ingestion failures (round 4) — the synthetic
      // cooldown-skip entries above are already-known failures, not new ones.
      for (const s of persistedSources) {
        if (s.fetch_error && !s.fetch_error.startsWith("domain_in_cooldown:")) {
          const category = classifyFailure(s.fetch_error);
          await recordFailure(supabaseAdmin(), {
            error: s.fetch_error,
            mission_id: missionId,
            mission_type: missionType,
            source_url: s.source_url,
            auto_retryable: category === "rate_limited" || category === "source_unavailable" || category === "timeout",
            cooldown_seconds: category === "rate_limited" ? 900 : category === "source_unavailable" ? 300 : undefined,
          }).catch((e: any) => console.warn("[runMission] recordFailure (source) failed (non-fatal):", e?.message));
        }
      }
    }

    // 6–7. Extract + persist facts — skipped + reloaded on resume for the
    // same duplicate-insert reason as above.
    let persistedFacts: ResearchFact[];
    if (completed.has("fact_extraction")) {
      persistedFacts = await loadPersistedFacts(missionId);
      console.log(`[runMission] Resume: reused ${persistedFacts.length} previously-extracted fact(s)`);
    } else {
      const threadRunId = await beginStageTracking(missionId, "fact_extraction");
      const successfulSources = persistedSources.filter(
        (s) => s.fetch_error === null && s.raw_content !== null
      );

      const extractedFacts = extractFactsFromSources(successfulSources);

      const persistedFactsResult = await persistFacts(missionId, extractedFacts);
      if (!persistedFactsResult.ok) {
        await failStageTracking(threadRunId, persistedFactsResult.error ?? "persist_facts_failed");
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

      persistedFacts = persistedFactsResult.facts;
      await endStageTracking(threadRunId, persistedFacts.length);
      await checkpointStage(missionId, "fact_extraction", { persisted_count: persistedFacts.length });
    }

    // 8–9. Derive + persist inferences — skipped + reloaded on resume.
    let persistedInferences: ResearchInference[];
    if (completed.has("inference_derivation")) {
      persistedInferences = await loadPersistedInferences(missionId);
      console.log(`[runMission] Resume: reused ${persistedInferences.length} previously-derived inference(s)`);
    } else {
      const threadRunId = await beginStageTracking(missionId, "inference_derivation");
      persistedInferences = [];
      if (hasEnoughFactsForInferences(persistedFacts)) {
        const derivedInferences = deriveInferences(persistedFacts);

        const persistedInferencesResult = await persistInferences(missionId, derivedInferences.inferences);
        if (!persistedInferencesResult.ok) {
          // Non-fatal: we can still complete the mission without inferences
          console.warn(`Failed to persist inferences: ${persistedInferencesResult.error}`);
          await failStageTracking(threadRunId, persistedInferencesResult.error ?? "persist_inferences_failed");
        } else {
          persistedInferences = persistedInferencesResult.inferences;
          await endStageTracking(threadRunId, persistedInferences.length);
        }
      } else {
        await endStageTracking(threadRunId, 0);
      }
      await checkpointStage(missionId, "inference_derivation", { persisted_count: persistedInferences.length });
    }

    // 9b. Verification + provenance layers (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md
    // deferred item, now wired): these fully-built, tested modules had zero
    // production call sites — verification.ts's source-hygiene/corroboration/
    // freshness/contradiction/usability checks and provenance.ts's source-trust
    // → fact/inference confidence chain never ran. Both operate on the legacy
    // pipeline's own data (persistedSources/persistedFacts/persistedInferences),
    // which is already in scope here. Wired additively — this persists new
    // diagnostic evidence rows; it does NOT mutate the stored fact/inference
    // confidence values that compileNarrative/flagFromResearchInferences read,
    // to avoid silently shifting behavior calibrated against the original scale.
    // Non-fatal by the same convention as every other supplementary step below.
    try {
      const { runVerification, persistVerificationEvidence } = await import("./verification");
      const verificationReport = runVerification(missionId, persistedSources, persistedFacts, persistedInferences);
      await persistVerificationEvidence(supabaseAdmin(), missionId, verificationReport);
      if (!verificationReport.overallPass) {
        console.warn(
          `[runMission] verification layer: score=${verificationReport.score}/100 — failing checks: ` +
          verificationReport.checks.filter((c) => c.severity === "fail").map((c) => c.message).join("; "),
        );
      }
    } catch (verifyErr: any) {
      console.warn("[runMission] verification layer failed (non-fatal):", verifyErr?.message);
    }

    try {
      const { generateProvenanceReport } = await import("./provenance");
      const provenanceReport = generateProvenanceReport(persistedSources, persistedFacts, persistedInferences);
      if (provenanceReport.sources.length > 0) {
        await supabaseAdmin().from("buddy_research_evidence").insert({
          mission_id: missionId,
          evidence_type: "fact",
          claim: `Provenance chain-of-trust: ${provenanceReport.sources.length} source(s), avg source trust ${Math.round(provenanceReport.summary.avg_source_trust * 100)}%, avg fact confidence ${Math.round(provenanceReport.summary.avg_fact_confidence * 100)}%, avg inference confidence ${Math.round(provenanceReport.summary.avg_inference_confidence * 100)}%`,
          supporting_data: { kind: "provenance_summary", summary: provenanceReport.summary },
          confidence: provenanceReport.summary.avg_source_trust,
        });
      }
    } catch (provErr: any) {
      console.warn("[runMission] provenance layer failed (non-fatal):", provErr?.message);
    }

    // 10–11. Compile + persist legacy narrative — skipped on resume (mirrors
    // the other stages: persistNarrative() upserts by mission_id so it's
    // technically idempotent, but recompiling from already-persisted facts/
    // inferences is pure waste once this stage is known complete).
    let narrativeSectionsCount = 0;
    if (completed.has("narrative_compilation")) {
      const { data: existingNarrative } = await supabaseAdmin()
        .from("buddy_research_narratives")
        .select("sections")
        .eq("mission_id", missionId)
        .maybeSingle();
      narrativeSectionsCount = Array.isArray(existingNarrative?.sections) ? existingNarrative.sections.length : 0;
      console.log(`[runMission] Resume: legacy narrative already compiled (${narrativeSectionsCount} section(s)), skipping recompile`);
    } else {
      const threadRunId = await beginStageTracking(missionId, "narrative_compilation");
      const narrativeResult = compileNarrative(persistedFacts, persistedInferences, persistedSources);
      narrativeSectionsCount = narrativeResult.sections.length;

      if (narrativeResult.ok && narrativeResult.sections.length > 0) {
        // Phase 74: validate narrative against output contract (non-fatal)
        try {
          const { validateResearchNarrative } = await import(
            "@/lib/agentWorkflows/contracts/researchNarrative.contract"
          );
          const validation = validateResearchNarrative({
            sections: narrativeResult.sections,
            version: 1,
          });
          if (!validation.ok) {
            console.warn(
              `[runMission] narrative contract validation ${validation.severity}:`,
              validation.errors?.issues?.map((i: any) => i.message).join("; "),
            );
          }
        } catch {
          // Contract validation must never block mission
        }

        const narrativePersistResult = await persistNarrative(missionId, narrativeResult.sections);
        if (!narrativePersistResult.ok) {
          // Non-fatal: mission is still successful
          console.warn(`Failed to persist narrative: ${narrativePersistResult.error}`);
        }
      }
      await endStageTracking(threadRunId, narrativeSectionsCount);
      await checkpointStage(missionId, "narrative_compilation", { sections_count: narrativeSectionsCount });
    }

    // 12. Mark mission as complete
    //
    // FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): previously this
    // unconditionally marked "complete" with no distinguishing signal even
    // when every source failed to fetch and the mission produced zero facts
    // and zero narrative sections — indistinguishable in the DB from a
    // genuinely successful mission except by an operator manually comparing
    // counts. status stays "complete" (the process legitimately finished
    // without throwing), but error_message now records the degraded-output
    // signal so it's queryable/visible without inventing a new status value
    // (the DB CHECK constraint on `status` doesn't allow one without a
    // migration, which this fix deliberately avoids).
    const hadNoOutput = persistedFacts.length === 0 && narrativeSectionsCount === 0;
    await updateMissionStatus(
      missionId,
      "complete",
      hadNoOutput
        ? `degraded: 0 facts, 0 narrative sections from ${persistedSources.length} source(s) — legacy pipeline produced no usable output`
        : undefined,
    );

    // 12b. Buddy Intelligence Engine — runs after mission is marked complete (non-fatal)
    //
    // Resumable missions (round 4): if a previous attempt already ran BIE to
    // full completion — hallucination guard, narrative upsert, claim ledger,
    // completion gate all persisted — skip this entire block on a resumed
    // mission. Nothing downstream (gap_analysis, flag_bridging) reads
    // bieResult, so there's nothing lost by not reconstructing it.
    const priorBieCheckpoint = completed.has("bie_enrichment") ? await loadLatestBieCheckpointState(missionId) : null;
    if (priorBieCheckpoint?.gate_and_claims_persisted) {
      console.log("[runMission] Resume: BIE + trust layer already fully persisted, skipping bie_enrichment");
    } else {
    try {
      // Phase 80: Pre-research subject lock — validate entity is sufficiently identified
      const { validateSubjectLock } = await import("./subjectLock");
      const subjectLockResult = validateSubjectLock({
        company_name: subject.company_name,
        naics_code: subject.naics_code,
        naics_description: subject.naics_description,
        business_description: subject.business_description,
        city: subject.city,
        state: subject.state,
        geography: subject.geography,
        website: subject.website,
        dba: subject.dba,
        banker_summary: subject.banker_summary,
        banker_override: subject.banker_override,
      });

      if (!subjectLockResult.ok) {
        console.warn(
          `[runMission] Subject lock failed for deal ${dealId}: ${subjectLockResult.reasons.join("; ")}. Skipping BIE.`,
        );
        // Persist the subject lock failure as a quality gate event
        try {
          const sbLock = supabaseAdmin();
          await (sbLock as any).from("buddy_research_quality_gates").upsert({
            mission_id: missionId,
            deal_id: dealId,
            trust_grade: "manual_review_required",
            gate_passed: false,
            quality_score: 0,
            gate_failures: subjectLockResult.reasons.map((r) => ({
              gate_id: "subject_lock",
              reason: r,
            })),
            evaluated_at: new Date().toISOString(),
          }, { onConflict: "mission_id" });
        } catch (e: any) {
          // FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): this bare
          // catch previously logged nothing at all — a subject-lock-failure
          // mission whose quality-gate write ALSO failed left zero trace
          // anywhere (no log line, no DB row) for an operator to find.
          console.warn("[runMission] subject-lock quality-gate persistence failed (non-fatal):", e?.message);
        }
      }

      const hasCompany = !!(subject.company_name && subject.company_name.trim().length > 2);
      const hasNaics = !!(subject.naics_code && subject.naics_code !== "999999");

      if (subjectLockResult.ok && (hasCompany || hasNaics)) {
        const { runBuddyIntelligenceEngine, buildBIENarrativeSections } = await import(
          "./buddyIntelligenceEngine"
        );

        const bieInput = {
          company_name: subject.company_name ?? null,
          naics_code: subject.naics_code ?? null,
          naics_description: subject.naics_description ?? null,
          city: subject.city ?? null,
          state: subject.state ?? null,
          geography: subject.geography ?? null,
          principals: subject.principals ?? [],
          annual_revenue: subject.annual_revenue ?? null,
          loan_amount: subject.loan_amount ?? null,
          loan_purpose: subject.loan_purpose ?? null,
          // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
          legal_name: subject.legal_name ?? null,
          dba: subject.dba ?? null,
          website: subject.website ?? null,
          business_description: subject.business_description ?? null,
          banker_summary: subject.banker_summary ?? null,
          customer_anchors: subject.customer_anchors ?? null,
          company_search_name: subject.company_search_name ?? null,
          private_company_mode: subject.private_company_mode ?? false,
          has_banker_certified_anchor: subject.has_banker_certified_anchor ?? false,
        };

        // Resumable BIE (round 4): reuse whichever threads already succeeded
        // in a previous attempt (per priorBieCheckpoint's raw per-thread
        // output) instead of re-running all 8 Gemini threads from scratch.
        const bieResult = await runBuddyIntelligenceEngine(bieInput, {
          previousThreadResults: priorBieCheckpoint?.thread_results,
        });

        // Checkpoint the raw per-thread output immediately — before anything
        // else below has a chance to throw — so a thread that succeeded this
        // attempt is never lost even if a later step (narrative upsert,
        // claim ledger) fails. gate_and_claims_persisted is set true only
        // after everything below finishes without throwing.
        await saveBieCheckpoint(missionId, extractBieThreadResults(bieResult), false);
        await recordBieThreadFailures(missionId, missionType, bieResult);

        // SPEC-BIE-...-MEGA-1 Phase 1: persist per-thread diagnostics on the
        // mission row unconditionally — especially when research_quality is
        // "minimal", which is exactly when the banker needs to know WHY a thread
        // produced nothing. Non-fatal.
        try {
          const sbDiag = supabaseAdmin();
          await (sbDiag as any)
            .from("buddy_research_missions")
            .update({ thread_diagnostics: bieResult.thread_diagnostics })
            .eq("id", missionId);
        } catch (e: any) {
          console.warn("[runMission] thread_diagnostics persist failed (non-fatal):", e?.message);
        }

        if (bieResult.research_quality !== "minimal") {
          // Build BIE sections — mutable so we can apply the hallucination guard below
          let bieSections = buildBIENarrativeSections(bieResult);

          // ── Layer 2: Management Intelligence Hallucination Guard ────────────────
          // Before storing, validate that the Management Intelligence section only
          // names principals who appear in the deal's actual ownership_entities.
          //
          // Root cause being defended against: Gemini searches the web for the
          // company_name and may find similarly-named real-world companies, then
          // generates management profiles for those companies' actual executives.
          // Those profiles get stored under the deal as if they're the borrower's
          // management team — a critical trust violation for a regulated platform.
          //
          // Defense: extract last names from known principals, scan the section
          // text for them. If zero match AND we have known principals on file,
          // strip the section before storage (log it for observability).
          //
          // Note: Layer 1 (root cause prevention) is the display_name fix in
          // research/run/route.ts which ensures principals are populated correctly.
          // Layer 3 is the memo render guard in loadResearchForMemo.ts.
          const knownPrincipals: Array<{ name: string; title: string | null }> =
            (subject as any).principals ?? [];

          if (knownPrincipals.length > 0) {
            // Build a set of last names (lowercased) for fuzzy matching
            const knownLastNames = new Set(
              knownPrincipals
                .map((p) => p.name.trim().split(/\s+/).pop()?.toLowerCase())
                .filter((s): s is string => typeof s === "string" && s.length > 1)
            );

            const mgmtSectionIdx = bieSections.findIndex(
              (s: any) => (s.title as string) === "Management Intelligence"
            );

            if (mgmtSectionIdx !== -1) {
              const mgmtSection = bieSections[mgmtSectionIdx] as any;
              const sectionText = (mgmtSection.sentences ?? [])
                .map((s: any) => String(s.text ?? ""))
                .join(" ")
                .toLowerCase();

              const anyKnownPrincipalMentioned = [...knownLastNames].some((lastName) =>
                sectionText.includes(lastName)
              );

              if (!anyKnownPrincipalMentioned) {
                // The section names people we don't recognize — strip it.
                // The Monitoring Triggers section often references the same management
                // names (e.g. "departure of Tim J. Shrout"), so scrub that too.
                const SCRUB_TITLES = new Set(["Management Intelligence", "Monitoring Triggers"]);
                bieSections = bieSections.filter((s: any) => !SCRUB_TITLES.has(s.title as string));

                console.warn(
                  `[runMission] HALLUCINATION GUARD: BIE Management Intelligence section ` +
                  `scrubbed for deal ${dealId}. Known principals: [${[...knownLastNames].join(", ")}]. ` +
                  `None found in generated output — likely web-scraped profiles from a ` +
                  `similarly-named real-world company. Section removed before DB storage.`
                );
              } else {
                console.log(
                  `[runMission] BIE Management Intelligence validated for deal ${dealId}: ` +
                  `known principal(s) confirmed in output text.`
                );
              }
            }
          } else {
            // No known principals on file — we have nothing to validate against.
            // Strip Management Intelligence entirely as a safety measure: without
            // ground-truth owners we cannot tell if the output is accurate.
            const hasMgmtSection = bieSections.some(
              (s: any) => (s.title as string) === "Management Intelligence"
            );
            if (hasMgmtSection) {
              const SCRUB_TITLES = new Set(["Management Intelligence", "Monitoring Triggers"]);
              bieSections = bieSections.filter((s: any) => !SCRUB_TITLES.has(s.title as string));
              console.warn(
                `[runMission] HALLUCINATION GUARD: Management Intelligence section scrubbed ` +
                `for deal ${dealId} — no ownership_entities found for this deal so output ` +
                `cannot be validated against actual owners. Section removed before DB storage.`
              );
            }
          }
          // ── End Management Intelligence Hallucination Guard ─────────────────────

          // ── Layer 2b: Borrower Profile / Litigation and Risk Hallucination Guard ──
          // SPEC audit P0-3 (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md): unlike
          // Management Intelligence, these sections previously had NO code-level
          // hallucination guard at all — only a soft low-confidence caveat attached
          // to Borrower Profile (never to Litigation and Risk), relying entirely on
          // prompt-only "entity disambiguation" instructions LLMs don't reliably
          // follow. A false litigation/adverse-event claim attributed to the wrong
          // entity is a serious, borrower-damaging error, so it deserves the same
          // code-level defense as Management.
          //
          // Defense: when the deterministic entity classification (computed in
          // code, not trusted from the model — see classifyEntity()) says BIE
          // research actually locked onto a DIFFERENT real entity than the one we
          // searched for (wrong_entity_risk), the entire Borrower Profile +
          // Litigation and Risk output is untrustworthy — strip both before
          // storage. Otherwise, make sure the low-confidence caveat is visible on
          // Litigation and Risk too, not just Borrower Profile.
          if (bieResult.entity_classification === "wrong_entity_risk") {
            const SCRUB_TITLES = new Set(["Borrower Profile", "Litigation and Risk"]);
            const hadSections = bieSections.some((s: any) => SCRUB_TITLES.has(s.title as string));
            bieSections = bieSections.filter((s: any) => !SCRUB_TITLES.has(s.title as string));
            if (hadSections) {
              console.warn(
                `[runMission] HALLUCINATION GUARD: Borrower Profile + Litigation and Risk ` +
                `scrubbed for deal ${dealId} — deterministic entity classification is ` +
                `wrong_entity_risk (research locked onto a different real entity than ` +
                `"${subject.company_search_name ?? subject.company_name ?? "unknown"}"). Content removed ` +
                `before DB storage to avoid attributing findings (including any adverse/` +
                `litigation claims) to the wrong company.`
              );
            }
          } else {
            const borrowerConfidence = bieResult.borrower?.entity_confidence;
            if (typeof borrowerConfidence === "number" && borrowerConfidence < 0.7) {
              const caveat =
                `NOTE: Entity confidence is ${Math.round(borrowerConfidence * 100)}% — this ` +
                `content may be incomplete or partially attributed to a similarly-named entity.`;
              const litigationIdx = bieSections.findIndex(
                (s: any) => (s.title as string) === "Litigation and Risk"
              );
              if (litigationIdx !== -1) {
                const section = bieSections[litigationIdx] as any;
                const alreadyCaveated = (section.sentences ?? []).some((s: any) =>
                  String(s.text ?? "").startsWith("NOTE: Entity confidence")
                );
                if (!alreadyCaveated) {
                  section.sentences = [
                    { text: caveat, citations: section.sentences?.[0]?.citations ?? [] },
                    ...(section.sentences ?? []),
                  ];
                }
              }
            }
          }
          // ── End Borrower Profile / Litigation and Risk Hallucination Guard ──────

          const sb2 = supabaseAdmin();
          const { error: bieUpsertErr } = await (sb2 as any)
            .from("buddy_research_narratives")
            .upsert(
              { mission_id: missionId, sections: bieSections, version: 3 },
              { onConflict: "mission_id" },
            );
          if (bieUpsertErr) {
            console.warn("[runMission] BIE narrative upsert failed:", bieUpsertErr.message);
          } else {
            console.log(
              `[runMission] BIE complete: quality=${bieResult.research_quality}, sources=${bieResult.sources_used.length}, sections=${bieSections.length}`,
            );
          }

          // ── Claim Ledger + Completion Gate ──────────────────────────────────
          try {
            const { persistClaimLedger } = await import("./claimLedger");
            const { evaluateCompletionGate } = await import("./completionGate");
            const { computeEvidenceCoverage } = await import("./evidenceCoverage");

            // 1. Write structured claims to buddy_research_evidence
            const claimResult = await persistClaimLedger(missionId, bieResult);
            console.log(`[runMission] claim ledger: ${claimResult.claims_written} claims written`);

            // 2. Phase 82: Compute evidence coverage from any previously generated memo
            // (will be null for first research run on a new deal — Gate 9 exempts these)
            const evidenceCoverage = await computeEvidenceCoverage(dealId, opts?.bankId ?? "").catch(() => null);

            // 3. Run deterministic completion gate
            // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: pass the
            // deterministic entity disposition + banker-certified evidence flags so
            // a private/banker-certified borrower isn't auto-failed on public gaps.
            const gateResult = evaluateCompletionGate(bieResult, missionId, {
              naicsCode: subject.naics_code,
              evidenceSupportRatio: evidenceCoverage?.supportRatio ?? null,
              entityClassification: bieResult.entity_classification,
              bankerCertifiedEvidence: {
                hasStory: !!(subject.business_description && subject.business_description.trim().length > 0),
                hasManagement: (subject.principals?.length ?? 0) > 0,
                hasFinancials: subject.annual_revenue != null,
              },
              // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 1: provenance.
              managementBasis: bieResult.management_basis,
              // Phase 2: borrower's own website domain for source classification.
              borrowerDomain: subject.website ?? null,
              // Phase 5/6: loan-file / banker-certified evidence signals from the subject.
              evidenceSignals: {
                hasLegalName: !!subject.legal_name,
                hasWebsite: !!subject.website,
                hasHqLocation: !!(subject.city || subject.state || subject.geography),
                hasBankerIdentitySummary: !!subject.banker_summary,
                hasNaics: !!(subject.naics_code && subject.naics_code !== "999999"),
                hasIndustryDescription: !!subject.naics_description,
                hasBusinessDescription: !!(subject.business_description && subject.business_description.trim().length > 0),
                hasCustomerAnchors: !!subject.customer_anchors,
                hasRevenue: subject.annual_revenue != null,
                hasLoanRequest: !!(subject.loan_purpose || subject.loan_amount),
                privateCompanyMode: subject.private_company_mode ?? false,
              },
              annualRevenue: subject.annual_revenue ?? null,
            });
            console.log(
              `[runMission] completion gate: trust_grade=${gateResult.trust_grade}, ` +
              `quality=${gateResult.quality_score}/100, entity_confidence=${Math.round(gateResult.entity_confidence * 100)}%`
            );

            // 3. Persist gate result
            await sb2.from("buddy_research_quality_gates").upsert({
              mission_id: missionId,
              deal_id: dealId,
              trust_grade: gateResult.trust_grade,
              gate_passed: gateResult.gate_passed,
              quality_score: gateResult.quality_score,
              entity_lock_check: gateResult.checks.find(c => c.gate_id === "entity_lock")?.status ?? "not_run",
              entity_confidence: gateResult.entity_confidence,
              thread_coverage_check: gateResult.checks.find(c => c.gate_id === "thread_coverage")?.status ?? "not_run",
              threads_succeeded: gateResult.threads_succeeded,
              threads_failed: gateResult.threads_failed,
              source_diversity_check: gateResult.checks.find(c => c.gate_id === "source_diversity")?.status ?? "not_run",
              source_count: gateResult.source_count,
              management_validation_check: gateResult.checks.find(c => c.gate_id === "management_validation")?.status ?? "not_run",
              principals_confirmed: gateResult.principals_confirmed,
              principals_unconfirmed: gateResult.principals_unconfirmed,
              synthesis_check: gateResult.checks.find(c => c.gate_id === "synthesis")?.status ?? "not_run",
              contradictions_found: gateResult.contradictions_found,
              underwriting_questions_found: gateResult.underwriting_questions_found,
              gate_failures: gateResult.checks.filter(c => c.status !== "pass").map(c => ({
                gate_id: c.gate_id, reason: c.reason, severity: c.severity,
              })),
              // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phases 3–6:
              // structured artifacts for the research flight deck.
              section_source_statuses: gateResult.section_source_statuses,
              contradiction_checklist: gateResult.contradiction_checklist,
              evidence_quality: gateResult.evidence_quality,
              preliminary_eligible: gateResult.preliminary_eligible,
              committee_eligible: gateResult.committee_eligible,
              preliminary_basis: gateResult.preliminary_basis,
              committee_blockers: gateResult.committee_blockers,
              thread_results: {
                borrower: bieResult.borrower ? "ok" : "null",
                management: bieResult.management ? "ok" : "null",
                competitive: bieResult.competitive ? "ok" : "null",
                market: bieResult.market ? "ok" : "null",
                industry: bieResult.industry ? "ok" : "null",
                transaction: bieResult.transaction ? "ok" : "null",
                synthesis: bieResult.synthesis ? "ok" : "null",
              },
              evaluated_at: gateResult.evaluated_at,
            }, { onConflict: "mission_id" });

            // 4. Update mission with trust metadata
            await sb2.from("buddy_research_missions").update({
              trust_grade: gateResult.trust_grade,
              completion_gate_status: gateResult.gate_passed ? "passed" : "failed",
              completion_gate_failures: gateResult.checks.filter(c => c.status !== "pass"),
              entity_confidence: gateResult.entity_confidence,
              entity_confirmed_name: bieResult.entity_lock?.confirmed_name ?? null,
              entity_lock_json: bieResult.entity_lock ?? null,
              threads_succeeded: gateResult.threads_succeeded,
              threads_failed: gateResult.threads_failed,
              management_profiles_validated: bieResult.synthesis?.management_profiles_validated ?? null,
              entity_validation_passed: bieResult.synthesis?.entity_validation_passed ?? null,
              research_quality_computed: gateResult.trust_grade === "committee_grade" ? "Strong"
                : gateResult.trust_grade === "preliminary" ? "Moderate" : "Limited",
            }).eq("id", missionId);

          } catch (trustErr: any) {
            // Non-fatal — claim ledger and gate failures must never block mission completion
            console.warn("[runMission] trust layer failed (non-fatal):", trustErr?.message);
            await writeDegradedQualityGate(
              missionId, dealId, "trust_layer_exception",
              `Claim ledger / completion gate threw before persisting: ${trustErr?.message ?? "unknown error"}`,
            );
          }

          // SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1:
          // generate committee evidence-collection tasks + snapshot the borrower
          // website. Non-fatal — never blocks mission completion, never changes
          // gate semantics.
          try {
            const { ensureCommitteeEvidenceTasks } = await import("./committeeEvidenceCollection");
            const taskResult = await ensureCommitteeEvidenceTasks({ missionId, dealId });
            console.log(
              `[runMission] committee evidence tasks: ${taskResult.tasks_upserted} task(s); ` +
              `website snapshot=${taskResult.website_snapshot?.status ?? "n/a"}`,
            );
          } catch (taskErr: any) {
            console.warn("[runMission] committee evidence tasks failed (non-fatal):", taskErr?.message);
          }

          // Perfect Banker Flow v1.1 — research finished. Refresh readiness
          // so the rail flips from "research_stalled" to ready without the
          // banker manually reloading. Fire-and-forget.
          try {
            const { scheduleReadinessRefresh } = await import(
              "@/lib/deals/readiness/refreshDealReadiness"
            );
            scheduleReadinessRefresh({ dealId, trigger: "research_completed" });
          } catch {
            // Hook is best-effort.
          }

          // Everything below the raw-thread-result checkpoint above
          // (hallucination guard, narrative upsert, claim ledger, completion
          // gate, committee tasks) finished without throwing — mark this
          // stage fully done so a resumed retry skips the whole block
          // instead of just reusing thread results.
          await saveBieCheckpoint(missionId, extractBieThreadResults(bieResult), true);
        } else {
          console.log("[runMission] BIE skipped: minimal quality (no usable company name or NAICS)");
        }
      }
    } catch (bieErr: any) {
      console.warn("[runMission] BIE step failed (non-fatal):", bieErr?.message);
      // FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): previously a BIE
      // crash left the mission at status="complete" with no trust_grade and
      // no quality_gates row at all — a banker sees a "complete" research
      // mission with none of the differentiated BIE analysis and nothing
      // telling them so. Write an explicit degraded row so this state is
      // queryable, not just an absence.
      await writeDegradedQualityGate(
        missionId, dealId, "bie_exception",
        `Buddy Intelligence Engine threw before completion: ${bieErr?.message ?? "unknown error"}`,
      );
    }
    } // end resumable-mission bie_enrichment skip guard

    // 12c. Trigger gap recompute after BIE completes (non-fatal)
    try {
      const { computeDealGaps } = await import("@/lib/gapEngine/computeDealGaps");
      if (opts?.bankId) {
        void computeDealGaps({ dealId, bankId: opts.bankId }).catch(() => {});
      }
    } catch {
      // Non-fatal
    }

    // 13. Bridge: persist risk-indicator inferences as flags (non-fatal)
    try {
      if (persistedInferences.length > 0) {
        const { flagFromResearchInferences } = await import("./flagFromResearchInferences");
        const { persistResearchFlags } = await import("@/lib/flagEngine/persistResearchFlags");
        const researchFlags = flagFromResearchInferences(dealId, persistedInferences, missionType);
        if (researchFlags.length > 0) {
          await persistResearchFlags(dealId, researchFlags);
        }
      }
    } catch (err: any) {
      // Non-fatal — mission is already marked complete
      console.warn("[runMission] research→flag bridge failed (non-fatal)", err?.message);
    }

    return {
      ok: true,
      mission_id: missionId,
      sources_count: persistedSources.length,
      facts_count: persistedFacts.length,
      inferences_count: persistedInferences.length,
      narrative_sections: narrativeSectionsCount,
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
