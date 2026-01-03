import { deriveDealMode } from "@/lib/deals/deriveDealMode";

type Props = {
  checklistState: {
    state: "empty" | "ready";
    pendingCount: number;
  };
  pipeline?: {
    status?: string;
  };
  uploads?: {
    processing?: number;
  };
};

export function BorrowerPortalNarrator({
  checklistState,
  pipeline,
  uploads,
}: Props) {
  const derivedMode = deriveDealMode({
    checklist: {
      state: checklistState.state,
      pendingCount: checklistState.pendingCount,
    },
    pipeline,
    uploads,
  });

  return (
    <div className="text-sm text-neutral-600">
      {derivedMode === "initializing" && "Getting things ready…"}
      {derivedMode === "processing" && "Reviewing your documents…"}
      {derivedMode === "needs_input" && "We need a few more documents from you."}
      {derivedMode === "ready" && "Everything looks good on your end!"}
      {derivedMode === "blocked" && "Something needs attention before we continue."}
    </div>
  );
}
