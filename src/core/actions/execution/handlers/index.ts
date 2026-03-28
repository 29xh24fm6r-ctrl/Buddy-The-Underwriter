import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecuteCanonicalActionInput, ExecuteCanonicalActionResult } from "../types";
import type { CanonicalExecutionMapping } from "../canonicalActionExecutionMap";
import { handleRequestDocuments } from "./requestDocuments";
import { handleSeedChecklist } from "./seedChecklist";
import { handleRunExtraction } from "./runExtraction";
import { handleGenerateFinancialSnapshot } from "./generateFinancialSnapshot";
import { handleTaskOnly } from "./taskOnly";
import { handleNoActionRequired } from "./noActionRequired";

/**
 * Route a canonical action to its handler based on the execution mapping.
 */
export async function executeHandler(
  sb: SupabaseClient,
  input: ExecuteCanonicalActionInput,
  mapping: CanonicalExecutionMapping,
): Promise<ExecuteCanonicalActionResult> {
  const code = input.action.code;

  // Direct-write handlers
  if (code === "request_documents") return handleRequestDocuments(sb, input);
  if (code === "seed_checklist") return handleSeedChecklist(sb, input);

  // Queue handlers
  if (code === "run_extraction") return handleRunExtraction(sb, input);
  if (code === "generate_financial_snapshot") return handleGenerateFinancialSnapshot(sb, input);

  // Noop
  if (code === "no_action_required") return handleNoActionRequired();

  // All remaining actions are task-only for 65E
  if (mapping.mode === "task_only") return handleTaskOnly(input, mapping);

  // Defensive fallback — should not be reachable if map is exhaustive
  return handleTaskOnly(input, mapping);
}
