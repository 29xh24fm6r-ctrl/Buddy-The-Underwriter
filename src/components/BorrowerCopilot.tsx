"use client";
import { useState } from "react";

export function BorrowerCopilot({ dealId }: { dealId: string }) {
  const [msg, setMsg] = useState("");

  async function send() {
    await fetch(`/api/deals/${dealId}/copilot`, {
      method: "POST",
      body: JSON.stringify({ message: msg })
    });
    setMsg("");
  }

  return (
    <div className="border p-4 rounded">
      <input value={msg} onChange={e => setMsg(e.target.value)} />
      <button onClick={send}>Ask Buddy</button>
    </div>
  );
}
