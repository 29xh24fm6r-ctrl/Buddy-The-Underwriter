/**
 * Plugin Slot System — Phase 66A (Commit 8)
 *
 * OpenAEON-inspired plugin architecture for the research pipeline.
 * Allows extending the research pipeline with custom stages
 * without modifying core code.
 *
 * Plugins can hook into:
 * - Pre-stage: before a stage executes
 * - Post-stage: after a stage completes (receives stage output)
 * - Custom stages: entirely new stages added to the pipeline
 *
 * All plugins are:
 * - Registered at startup
 * - Executed in priority order
 * - Non-blocking by default (failures don't stop the pipeline)
 * - Auditable (execution recorded in thread runs)
 */

import type { CheckpointStage } from "../checkpoint";

// ============================================================================
// Types
// ============================================================================

export type PluginHook = "pre_stage" | "post_stage" | "custom_stage";

export type PluginPriority = number; // Lower = runs first

export type PluginContext = {
  missionId: string;
  dealId: string;
  bankId: string;
  stage: CheckpointStage;
  stageOutput?: unknown;
};

export type PluginResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
};

export type PluginDefinition = {
  name: string;
  description: string;
  hook: PluginHook;
  /** Which stage this hooks into (ignored for custom_stage) */
  targetStage?: CheckpointStage;
  priority: PluginPriority;
  /** Whether failure should halt the pipeline */
  blocking: boolean;
  /** Plugin execution function */
  execute: (ctx: PluginContext) => Promise<PluginResult>;
};

// ============================================================================
// Plugin Registry
// ============================================================================

const plugins: PluginDefinition[] = [];

/**
 * Register a plugin.
 */
export function registerPlugin(plugin: PluginDefinition): void {
  plugins.push(plugin);
  // Keep sorted by priority
  plugins.sort((a, b) => a.priority - b.priority);
}

/**
 * Get plugins for a specific hook and stage.
 */
export function getPlugins(hook: PluginHook, stage?: CheckpointStage): PluginDefinition[] {
  return plugins.filter((p) => {
    if (p.hook !== hook) return false;
    if (stage && p.targetStage && p.targetStage !== stage) return false;
    return true;
  });
}

/**
 * Execute all plugins for a hook/stage combination.
 */
export async function executePlugins(
  hook: PluginHook,
  ctx: PluginContext,
): Promise<{ results: (PluginResult & { pluginName: string })[]; blocked: boolean }> {
  const applicable = getPlugins(hook, ctx.stage);
  const results: (PluginResult & { pluginName: string })[] = [];
  let blocked = false;

  for (const plugin of applicable) {
    const start = Date.now();
    try {
      const result = await plugin.execute(ctx);
      results.push({ ...result, pluginName: plugin.name });

      if (!result.ok && plugin.blocking) {
        blocked = true;
        break;
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      results.push({
        ok: false,
        error: error.message,
        durationMs: Date.now() - start,
        pluginName: plugin.name,
      });

      if (plugin.blocking) {
        blocked = true;
        break;
      }
    }
  }

  return { results, blocked };
}

/**
 * Get all registered plugins.
 */
export function getAllPlugins(): PluginDefinition[] {
  return [...plugins];
}
