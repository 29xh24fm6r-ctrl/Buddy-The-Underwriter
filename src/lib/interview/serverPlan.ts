// src/lib/interview/serverPlan.ts
import {
  buildQuestionPlan,
  type ConfirmableCandidate,
  type ConfirmedFact,
} from "@/lib/interview/questionPlan";
import { getRequiredFactKeys } from "@/lib/interview/progress";

export function buildNextPlanFromDbRows(args: {
  factsRows: Array<any>;
  buddyTurnsRows: Array<any>;
}) {
  const confirmedByKey = new Map<string, ConfirmedFact>();
  const candidates: ConfirmableCandidate[] = [];

  for (const f of args.factsRows || []) {
    if (f.confirmed) {
      if (!confirmedByKey.has(f.field_key)) {
        confirmedByKey.set(f.field_key, {
          field_key: f.field_key,
          field_value: f.field_value,
          value_text: f.value_text,
        });
      }
    } else if (f.metadata?.suggested) {
      candidates.push({
        id: f.id,
        field_key: f.field_key,
        field_value: f.field_value,
        value_text: f.value_text,
        metadata: f.metadata,
      });
    }
  }

  const recentlyAskedKeys = new Set<string>();
  for (const t of args.buddyTurnsRows || []) {
    const k = t.payload?.question_key;
    if (k) recentlyAskedKeys.add(String(k));
  }

  const requiredKeys = getRequiredFactKeys(confirmedByKey);

  return buildQuestionPlan({
    confirmedByKey,
    requiredKeys,
    candidateFacts: candidates,
    recentlyAskedKeys,
  });
}
