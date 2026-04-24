import { StartConciergeClient } from "./StartConciergeClient";

export const metadata = {
  title: "Get your SBA loan — Buddy",
  description:
    "Buddy prepares your complete institutional-grade SBA loan package. Up to 3 matched lenders claim your deal. You pick. Fully neutral — we're paid the same no matter which lender wins.",
};

export default function StartPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            Get a real SBA loan, on your terms.
          </h1>
          <p className="text-lg text-slate-600">
            Buddy prepares your complete lender package. Up to 3 matched lenders
            claim your deal. You pick the one you want. We&apos;re paid the same
            no matter who wins — that&apos;s the point.
          </p>
        </header>
        <StartConciergeClient />
        <footer className="mt-12 text-center text-sm text-slate-500">
          Your conversation is saved to this browser. Share your email and
          we&apos;ll send you a link to pick up where you left off.
        </footer>
      </div>
    </main>
  );
}
