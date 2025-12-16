"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewDealPage() {
  const router = useRouter();
  const [name, setName] = useState("");

  function createDeal() {
    const dealId = crypto.randomUUID();
    router.push(`/deals/${dealId}?name=${encodeURIComponent(name)}`);
  }

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold">Create Deal</h1>

        <div className="rounded-xl border bg-white p-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Deal Name</span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Smith Manufacturing – Term Loan"
            />
          </label>

          <button
            onClick={createDeal}
            disabled={!name.trim()}
            className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-40"
          >
            Create & Open Workspace
          </button>
        </div>
      </div>
    </main>
  );
}
