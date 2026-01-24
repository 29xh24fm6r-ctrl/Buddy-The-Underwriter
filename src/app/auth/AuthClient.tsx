"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getSupabaseClient } from "@/lib/supabase/client";

function AuthForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = searchParams?.get("next") || "/";

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sb = getSupabaseClient();

      const { error: authError } = await sb!.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}${next}`,
        },
      });

      if (authError) {
        throw authError;
      }

      setSent(true);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <div className="text-4xl">✉️</div>
          <h1 className="mt-4 text-xl font-semibold text-white">
            Check your email
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            We sent a magic link to <strong>{email}</strong>
          </p>
          <p className="mt-4 text-sm text-slate-400">
            Click the link in your email to continue
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold text-white">Sign in</h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter your email to receive a magic link
        </p>

        <form onSubmit={handleAuth} className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
              <div className="text-sm text-rose-200">{error}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send magic link"}
          </button>
        </form>

        <div className="mt-6 rounded-lg border border-white/10 bg-black/10 p-4">
          <div className="text-xs text-slate-400">
            No password required. We'll email you a secure link to sign in.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthClient() {
  return (
    <AppShell>
      <AuthForm />
    </AppShell>
  );
}
