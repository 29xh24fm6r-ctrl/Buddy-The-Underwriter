"use client";

/**
 * Email-verification gate that sits in front of the /start concierge chat.
 *
 * A borrower gives their name + email, gets a 6-digit code, and verifying
 * it is the moment their private workspace is created — the whole chat
 * conversation happens inside it from message one, rather than an
 * anonymous session that only later gets tied to an email mid-conversation.
 * That's what makes the workspace durable across devices: identity is keyed
 * on the confirmed email (see resolveOrCreateVerifiedBorrowerSession in
 * lib/brokerage/emailVerification.ts), not on whatever session cookie a
 * browser happens to already be holding.
 */

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type Step = "identify" | "code" | "settling";

export type VerifiedSession = { dealId: string; name: string | null };

async function postSession(body: Record<string, unknown>) {
  const res = await fetch("/api/brokerage/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function BorrowerWorkspaceGate({
  onVerified,
}: {
  onVerified: (session: VerifiedSession) => void;
}) {
  const [step, setStep] = React.useState<Step>("identify");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [resendCooldown, setResendCooldown] = React.useState(0);

  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [resendCooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim()) {
      setError("Enter your email to get started.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { res, data } = await postSession({ action: "send", name, email });
      if (!res.ok || !data?.ok) {
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "60");
          setResendCooldown(retryAfter);
          setError("Too many codes requested — try again shortly.");
        } else if (data?.error === "valid_email_required") {
          setError("That email doesn't look right — double-check it.");
        } else {
          setError("Buddy couldn't send that code. Please try again.");
        }
        return;
      }
      setResendCooldown(30);
      setStep("code");
    } catch {
      setError("Buddy couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.trim().length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await postSession({ action: "verify", email, code, name });
      if (!data?.ok) {
        const messages: Record<string, string> = {
          invalid_code: "That code isn't right — check your email and try again.",
          expired: "That code expired — send a new one.",
          too_many_attempts: "Too many tries — send a new code.",
          not_found: "Send a code first.",
        };
        setError(messages[data?.error] ?? "Buddy couldn't verify that code. Please try again.");
        if (data?.error === "expired" || data?.error === "too_many_attempts") {
          setStep("identify");
        }
        return;
      }
      setStep("settling");
      window.setTimeout(() => {
        onVerified({ dealId: data.dealId as string, name: name.trim() || null });
      }, 900);
    } catch {
      setError("Buddy couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "settling") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <div className="brand-gradient-cta flex h-14 w-14 items-center justify-center rounded-full">
          <Icon name="auto_awesome" className="h-7 w-7 animate-pulse text-white" />
        </div>
        <p className="text-sm font-semibold text-slate-900">Setting up your workspace…</p>
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="brand-gradient-cta flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Icon name="mail" className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-heading text-lg font-bold text-slate-900">Check your email</h2>
            <p className="text-sm text-slate-600">
              We sent a 6-digit code to <span className="font-medium text-slate-900">{email}</span>.
            </p>
          </div>
        </div>
        <form onSubmit={verifyCode} className="space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            aria-label="6-digit verification code"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.5em] text-slate-900 focus:border-brand-blue-500 focus:outline-none focus:ring-2 focus:ring-brand-blue-500/30"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="brand-gradient-cta w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {submitting ? "Verifying…" : "Verify and enter my workspace"}
          </button>
        </form>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            onClick={() => {
              setStep("identify");
              setCode("");
              setError(null);
            }}
            className="font-medium text-slate-600 underline hover:text-slate-900"
          >
            Use a different email
          </button>
          <button
            type="button"
            disabled={resendCooldown > 0 || submitting}
            onClick={() => void sendCode()}
            className="font-medium text-brand-blue-500 underline hover:text-brand-blue-600 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="brand-gradient-cta flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <Icon name="auto_awesome" className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-heading text-lg font-bold text-slate-900">Let's set up your workspace</h2>
          <p className="text-sm text-slate-600">
            A private space just for your SBA package — accessible from any device, always yours.
          </p>
        </div>
      </div>
      <form onSubmit={sendCode} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          aria-label="Your name"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-brand-blue-500 focus:outline-none focus:ring-2 focus:ring-brand-blue-500/30"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="you@email.com"
          autoComplete="email"
          aria-label="Your email"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-brand-blue-500 focus:outline-none focus:ring-2 focus:ring-brand-blue-500/30"
        />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || resendCooldown > 0}
          className="brand-gradient-cta w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {submitting ? "Sending…" : resendCooldown > 0 ? `Try again in ${resendCooldown}s` : "Send my code"}
        </button>
      </form>
      <p className="mt-3 text-center text-xs text-slate-500">
        We'll only ever use this to save your progress and let you back in.
      </p>
    </div>
  );
}
