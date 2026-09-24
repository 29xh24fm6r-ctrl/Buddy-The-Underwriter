import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ArtifactSection, ReviewIssue } from "./frontierArtifactFactory";

export type ReviewCheckpoint = {
  version: 1;
  cycle: number;
  phase: "review" | "repair" | "done";
  sections: ArtifactSection[];
  repaired: boolean;
  reviewPasses: number;
  remaining: ReviewIssue[];
  completedBatches: Record<string, ArtifactSection[]>;
};
export type ReviewCheckpointStore = {
  state: ReviewCheckpoint | null;
  save(state: ReviewCheckpoint): Promise<void>;
};
export type ReviewCheckpointClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
};
const section = z.object({ key: z.string(), text: z.string().min(1) });
const stateSchema = z.object({
  version: z.literal(1), cycle: z.number().int().min(0).max(3),
  phase: z.enum(["review", "repair", "done"]), sections: z.array(section).min(1),
  repaired: z.boolean(), reviewPasses: z.number().int().min(0).max(4),
  remaining: z.array(z.object({
    sectionKey: z.string(), repairSectionKeys: z.array(z.string()).min(1).optional(), claim: z.string(), reason: z.string(),
    severity: z.enum(["info", "warning", "critical"]),
    category: z.enum(["unsupported_fact", "numeric_inconsistency", "missing_analysis", "generic_language", "credit_policy", "cross_artifact_conflict"]),
    repairInstruction: z.string(),
  })),
  completedBatches: z.record(z.string(), z.array(section)),
});

/** The caller keeps ownership through both review and publication of its verdict. */
export async function withReviewCheckpoint<T>(args: {
  sb: ReviewCheckpointClient; bankId: string; dealId: string;
  artifactType: "business_plan" | "feasibility"; artifactId: string;
  inputHash: string; sections: ArtifactSection[];
}, work: (store: ReviewCheckpointStore) => Promise<T>): Promise<T> {
  const owner = randomUUID();
  let revision = 0;
  const call = async (action: string, state: ReviewCheckpoint | null = null) => {
    const { data, error } = await args.sb.rpc("institutional_review_checkpoint", {
      p_action: action, p_bank_id: args.bankId, p_deal_id: args.dealId,
      p_artifact_type: args.artifactType, p_artifact_id: args.artifactId,
      p_input_hash: args.inputHash, p_owner: owner, p_revision: revision, p_state: state,
    });
    if (error || !data) throw new Error(`review_checkpoint_${action}_failed: ${error?.message ?? "empty response"}`);
    revision = Number(data.revision);
    if (!Number.isSafeInteger(revision)) throw new Error("review_checkpoint_invalid_revision");
    return data;
  };
  const claimed = await call("claim");
  try {
    const state = claimed.state == null ? null : stateSchema.parse(claimed.state);
    if (state) {
      const expected = args.sections.map(s => s.key).sort();
      const actual = state.sections.map(s => s.key).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected) || new Set(actual).size !== actual.length ||
          state.reviewPasses !== state.cycle + (state.phase === "review" ? 0 : 1) ||
          (state.phase === "repair" && (state.cycle === 3 || !state.remaining.some(i => i.severity === "critical"))) ||
          (state.phase !== "repair" && Object.keys(state.completedBatches).length))
        throw new Error("review_checkpoint_invalid_state");
    }
    return await work({ state, save: async next => { await call("save", stateSchema.parse(next)); } });
  } finally {
    // Release failures also fail closed. An abandoned lease expires; checkpoint
    // contents remain available and no verdict is inferred from ownership alone.
    await call("release");
  }
}
