"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
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
          role: initialScreen.role,
        }),
      });

      const data = await res.json();

      if (res.status === 401) {
        // Redirect to auth
        window.location.href = data.redirect || `/auth?next=/s/${screenId}`;
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
    <AppShell>
      <div className="mx-auto max-w-5xl">
        {/* Header actions */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">
              {initialScreen.title}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Generated {new Date(initialScreen.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExport(true)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              🔗 Export
            </button>

            <button
              type="button"
              onClick={() => setShowContinue(true)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Continue
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={claiming}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
            >
              {claiming ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Screen content */}
        <ScreenRenderer
          content={initialScreen.content}
          onAction={handleAction}
        />

        {/* Original prompt */}
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs font-semibold text-slate-300">
            Original prompt
          </div>
          <div className="mt-2 text-sm text-slate-200">
            {initialScreen.prompt}
          </div>
          {initialScreen.role && (
            <div className="mt-2 text-xs text-slate-400">
              Role: {initialScreen.role}
            </div>
          )}
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
      </div>
    </AppShell>
  );
}
