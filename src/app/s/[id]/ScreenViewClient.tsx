"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScreenRenderer } from "@/components/screens/ScreenRenderer";
import { ExportModal } from "@/components/screens/ExportModal";

type ScreenViewClientProps = {
  initialScreen: {
    id: string;
    title: string;
    layoutType: string;
    content: any;
    createdAt: string;
    prompt: string;
    role: string | null;
  };
  screenId: string;
};

export function ScreenViewClient(props: ScreenViewClientProps) {
  const { initialScreen, screenId } = props;
  const [showExport, setShowExport] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [continuePrompt, setContinuePrompt] = useState("");
  const [continueRole, setContinueRole] = useState<string>("");
  const [showContinue, setShowContinue] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSave = async () => {
    setClaiming(true);

    try {
      const res = await fetch(`/api/screens/${screenId}/claim`, {
        method: "POST",
      });

      const data = await res.json();

      if (res.status === 401) {
        // Redirect to auth
        window.location.href = data.redirect || `/auth?next=/s/${screenId}`;
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to save");
      }

      alert("Screen saved to your account!");
    } catch (err: any) {
      alert(err.message || "Failed to save screen");
    } finally {
      setClaiming(false);
    }
  };

  const handleContinue = async () => {
    if (!continuePrompt.trim()) {
      alert("Please enter a prompt");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/screens/${screenId}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: continuePrompt.trim(),
          role: continueRole || null,
        }),
      });

      const data = await res.json();

      if (res.status === 401) {
        // Redirect to auth
        window.location.href = data.redirect || `/auth?next=/s/${screenId}`;
        return;
      }

      if (res.status === 402 || res.status === 403) {
        // Upgrade required
        window.location.href = data.redirect || "/upgrade";
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to continue");
      }

      // Navigate to new screen
      router.push(data.shareUrl);
    } catch (err: any) {
      alert(err.message || "Failed to continue");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = (action: string) => {
    if (action === "save") {
      handleSave();
    } else if (action === "continue") {
      setShowContinue(true);
    } else {
      console.log("Action:", action);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-white text-slate-900">
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
            <div className="font-semibold tracking-tight">Buddy</div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowExport(true)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => setShowContinue(true)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Continue
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-10">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <ScreenRenderer
              content={initialScreen.content}
              onAction={handleAction}
            />
          </section>
        </main>

        <footer className="border-t border-slate-200">
          <div className="mx-auto max-w-5xl px-6 py-6 text-xs text-slate-500">
            Generated with Buddy
          </div>
        </footer>
      </div>

      {/* Export modal */}
      {showExport && (
        <ExportModal
          shareUrl={`/s/${screenId}`}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Continue modal */}
      {showContinue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">
              Continue with new prompt
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Describe how you want to modify this screen
            </p>

            <textarea
              value={continuePrompt}
              onChange={(e) => setContinuePrompt(e.target.value)}
              placeholder="e.g., Add a chart showing monthly trends..."
              className="mt-4 h-24 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />

            {/* Role selection */}
            <div className="mt-4">
              <label className="text-sm text-slate-300">
                Role (optional - improves generation)
              </label>
              <select
                value={continueRole}
                onChange={(e) => setContinueRole(e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                disabled={loading}
              >
                <option value="">No role — keep generic</option>
                <option value="Banker">Banker</option>
                <option value="Borrower">Borrower</option>
                <option value="Underwriter">Underwriter</option>
              </select>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowContinue(false)}
                className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={loading}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              >
                {loading ? "Generating..." : "Continue →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
