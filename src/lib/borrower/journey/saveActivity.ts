import type { GuidedQuestion, GuidedSnapshot } from "../guidedPackage/questions";
import { readGuidedResponse } from "./response";
import { canGroupQuestion } from "./factoryActivities";

export type ActivityDrafts = Record<string, {
  value: string; baseline: string | number | boolean | null; source: "text" | "voice";
}>;

/** Serial, resumable writes through the same canonical transaction used by single answers. */
export async function saveActivityAnswers(args: {
  questions: GuidedQuestion[]; snapshot: GuidedSnapshot; drafts: ActivityDrafts; dealId: string;
  request: typeof fetch; onSaved: (snapshot: GuidedSnapshot) => void;
}) {
  // Keep native browser fetch's receiver unbound (args is not a Window).
  const { request } = args;
  let latest = args.snapshot;
  for (const q of args.questions) {
    if (!canGroupQuestion(q)) throw new Error("Complete this answer in its dedicated review step.");
    const draft = args.drafts[q.id];
    if (!draft?.value.trim()) continue;
    const response = await request("/api/brokerage/concierge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "guided_answer", dealId: args.dealId, questionId: q.id,
        expectedValue: draft.baseline,
        value: q.type === "boolean" ? draft.value === "true" : draft.value,
        source: draft.source }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Please retry saving this activity.");
    latest = readGuidedResponse(data, args.dealId);
    delete args.drafts[q.id];
    args.onSaved(latest);
  }
  return latest;
}
