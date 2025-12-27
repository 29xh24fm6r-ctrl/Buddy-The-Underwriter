"use client";
import { useTransition } from "react";

export function DealActionsPanel({ dealId }: { dealId: string }) {
  const [pending, start] = useTransition();

  const run = (path: string) =>
    start(async () => {
      await fetch(`/api/deals/${dealId}/${path}`, { method: "POST" });
    });

  return (
    <div className="space-y-3 border p-4 rounded-xl">
      <button onClick={() => run("borrower-connect")} disabled={pending}>
        🔗 Connect Accounts
      </button>
      <button onClick={() => run("preapproval/run")} disabled={pending}>
        ⚡ Run Pre-Approval
      </button>
      <button onClick={() => run("autopilot/run")} disabled={pending}>
        🚀 Make E-Tran Ready
      </button>
    </div>
  );
}
