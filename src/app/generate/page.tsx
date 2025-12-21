"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [role, setRole] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          role: role || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }

      // Navigate to generated screen
      router.push(data.shareUrl);
    } catch (err: any) {
      setError(err.message || "Failed to generate screen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white">
              Generate Screen
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Describe the screen you want to create. Buddy will generate it
              instantly.
            </p>
          </div>

          <div className="space-y-4">
            {/* Prompt input */}
            <div>
              <label className="text-sm text-slate-300">
                What do you want to build?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., A borrower document checklist with upload status..."
                className="mt-2 h-32 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                disabled={loading}
              />
            </div>

            {/* Role selection */}
            <div>
              <label className="text-sm text-slate-300">
                Role (optional)
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                disabled={loading}
              >
                <option value="">Auto-detect</option>
                <option value="Banker">Banker</option>
                <option value="Borrower">Borrower</option>
                <option value="Underwriter">Underwriter</option>
              </select>
            </div>

            {/* Error display */}
            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
                <div className="text-sm text-rose-200">{error}</div>
              </div>
            )}

            {/* Generate button */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate Screen →"}
            </button>
          </div>

          {/* Examples */}
          <div className="mt-8 rounded-lg border border-white/10 bg-black/10 p-4">
            <div className="text-xs font-semibold text-slate-300">
              Example prompts:
            </div>
            <div className="mt-3 space-y-2">
              {[
                "Show me all documents I need to upload",
                "Create an underwriter dashboard with pending deals",
                "Banker portfolio overview with recent activity",
              ].map((example, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="block w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/10"
                  disabled={loading}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
