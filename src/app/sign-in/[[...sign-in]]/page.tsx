import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(900px_500px_at_20%_-10%,rgba(59,130,246,0.18),transparent_55%),radial-gradient(900px_500px_at_80%_0%,rgba(16,185,129,0.12),transparent_55%),linear-gradient(to_bottom,rgba(2,6,23,1),rgba(2,6,23,1))]">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
        <div className="grid w-full grid-cols-1 gap-10 md:grid-cols-2 items-center">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-300">Buddy Underwriter</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Meet Buddy.</h1>
            <p className="mt-3 text-lg text-slate-200">Your AI underwriting command center.</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Evidence, overlays, excerpts, borrower portal, and credit memo intelligence — unified.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
            <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
          </div>
        </div>
      </div>
    </div>
  );
}
