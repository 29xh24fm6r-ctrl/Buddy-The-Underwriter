"use client";

/**
 * SPEC-13 — banker-facing banner shown at the top of /credit-memo when
 * the memo-inputs gate has not passed yet.
 *
 * Behavior:
 *   - Renders a sentence-case explanation with the missing-inputs count.
 *   - Triggers a soft client-side redirect to /memo-inputs after 1.5s.
 *
 * The banker reads the banner first, understands what happened, and
 * then arrives on the inputs page — replacing SPEC-04's silent
 * `redirect()` which produced an unexplained URL flip.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type MemoInputsRedirectBannerProps = {
  dealId: string;
  missingCount: number;
  /** Override for tests; default is 1500ms. */
  redirectDelayMs?: number;
};

export default function MemoInputsRedirectBanner({
  dealId,
  missingCount,
  redirectDelayMs = 1500,
}: MemoInputsRedirectBannerProps) {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setRedirecting(true);
      router.push(`/deals/${dealId}/memo-inputs`);
    }, redirectDelayMs);
    return () => clearTimeout(t);
  }, [dealId, redirectDelayMs, router]);

  const inputsLabel =
    missingCount === 1 ? "1 quick input is" : `${missingCount} quick inputs are`;

  return (
    <div
      data-testid="memo-inputs-redirect-banner"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="font-semibold">
        {inputsLabel} needed before this memo can finalize — completing them now.
      </div>
      <div className="mt-1 text-xs text-amber-800">
        {redirecting
          ? "Taking you to memo inputs…"
          : "Banker review opens in a moment."}
      </div>
    </div>
  );
}
