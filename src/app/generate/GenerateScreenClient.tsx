"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function GenerateScreenClient() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Please describe the screen you want to generate.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to generate screen");
      }

      if (data?.shareUrl) {
        router.push(data.shareUrl);
        return;
      }

      throw new Error("No share URL returned");
    } catch (err: any) {
      setError(err?.message ?? "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border bg-white p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Buddy The Underwriter
          </div>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Generate a screen
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Describe the underwriting screen or workflow you need. We’ll generate a real,
            usable screen artifact you can share.
          </p>

          <form onSubmit={handleGenerate} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="prompt">
                Prompt
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="An underwriter dashboard showing loan status, missing documents, and risk flags…"
                className="mt-2 min-h-[160px] w-full rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Generating…" : "Generate screen"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
