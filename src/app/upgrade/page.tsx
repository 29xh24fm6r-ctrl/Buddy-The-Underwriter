"use client";

import { AppShell } from "@/components/shell/AppShell";

export default function UpgradePage() {
  const handleUpgrade = () => {
    // TODO: Integration with Stripe or payment provider
    alert("Upgrade flow coming soon! Contact sales@buddyunderwriter.com");
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <div className="text-5xl">🚀</div>

          <h1 className="mt-6 text-3xl font-bold text-white">
            You've reached your free limit
          </h1>

          <p className="mt-3 text-lg text-slate-300">
            Upgrade to Pro to keep generating and iterating on screens
          </p>

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Free plan */}
            <div className="rounded-xl border border-white/10 bg-black/20 p-6">
              <div className="text-sm font-semibold text-slate-400">
                Free Plan
              </div>
              <div className="mt-2 text-3xl font-bold text-white">$0</div>
              <div className="mt-1 text-sm text-slate-400">forever</div>

              <div className="mt-6 space-y-3">
                <Feature icon="✅" text="1 screen generation" />
                <Feature icon="✅" text="3 continues" />
                <Feature icon="✅" text="Shareable links" />
                <Feature icon="❌" text="Unlimited continues" dim />
                <Feature icon="❌" text="AI-powered generation" dim />
                <Feature icon="❌" text="Custom templates" dim />
              </div>

              <div className="mt-6">
                <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-400">
                  Current plan
                </div>
              </div>
            </div>

            {/* Pro plan */}
            <div className="relative rounded-xl border-2 border-blue-500/50 bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-6">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full border border-blue-500/30 bg-blue-500 px-3 py-1 text-xs font-semibold text-white">
                  RECOMMENDED
                </span>
              </div>

              <div className="text-sm font-semibold text-blue-400">
                Pro Plan
              </div>
              <div className="mt-2 text-3xl font-bold text-white">$29</div>
              <div className="mt-1 text-sm text-slate-400">per month</div>

              <div className="mt-6 space-y-3">
                <Feature icon="✅" text="Unlimited generations" />
                <Feature icon="✅" text="Unlimited continues" />
                <Feature icon="✅" text="Shareable links" />
                <Feature icon="✅" text="AI-powered generation" badge="Soon" />
                <Feature icon="✅" text="Custom templates" badge="Soon" />
                <Feature icon="✅" text="Priority support" />
              </div>

              <button
                type="button"
                onClick={handleUpgrade}
                className="mt-6 w-full rounded-lg bg-white px-4 py-3 text-sm font-bold text-slate-900 hover:bg-slate-100"
              >
                Upgrade to Pro →
              </button>
            </div>
          </div>

          {/* FAQ */}
          <div className="mt-12 rounded-xl border border-white/10 bg-black/10 p-6 text-left">
            <h2 className="text-lg font-semibold text-white">
              Frequently Asked Questions
            </h2>

            <div className="mt-4 space-y-4">
              <FAQ
                q="What happens to my existing screens?"
                a="All your existing screens remain accessible forever, even on the free plan."
              />
              <FAQ
                q="Can I cancel anytime?"
                a="Yes! Cancel anytime and you'll retain Pro access until the end of your billing period."
              />
              <FAQ
                q="What's included in AI-powered generation?"
                a="Coming soon: Custom AI models trained on your workflow, smart template suggestions, and automatic screen optimization."
              />
            </div>
          </div>

          {/* Back to screens */}
          <div className="mt-8">
            <a
              href="/generate"
              className="text-sm text-slate-400 hover:text-white"
            >
              ← Back to generation
            </a>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Feature({
  icon,
  text,
  dim = false,
  badge,
}: {
  icon: string;
  text: string;
  dim?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-lg">{icon}</span>
      <span className={dim ? "text-slate-500" : "text-slate-200"}>
        {text}
      </span>
      {badge && (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">
          {badge}
        </span>
      )}
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-white">{q}</div>
      <div className="mt-1 text-sm text-slate-300">{a}</div>
    </div>
  );
}
