"use client";

export default function DocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0f1115] p-6">
      <div className="max-w-2xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="material-symbols-outlined text-red-500 text-3xl">
              error
            </span>
            <div>
              <h1 className="text-xl font-bold text-white">
                Documents Page Error
              </h1>
              <p className="text-sm text-white/60 mt-1">
                Something went wrong loading the documents page
              </p>
            </div>
          </div>

          <pre className="mt-4 whitespace-pre-wrap rounded border border-white/10 bg-black/20 p-4 text-xs text-white/80 font-mono overflow-x-auto">
{String(error?.message || error)}
{error?.digest ? `\n\nDigest: ${error.digest}` : ""}
{error?.stack ? `\n\nStack:\n${error.stack}` : ""}
          </pre>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors"
            >
              Try Again
            </button>
            <a
              href="/deals"
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg transition-colors"
            >
              Go to Deals
            </a>
          </div>
        </div>

        <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-500 text-[20px]">
              info
            </span>
            <div className="text-sm text-white/70">
              <div className="font-semibold text-white mb-1">Debugging Info</div>
              <div>
                This error boundary caught a crash in the Documents page. Check:
              </div>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Environment variables (Supabase, Clerk)</li>
                <li>Network tab for failed API calls</li>
                <li>Console for additional errors</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
