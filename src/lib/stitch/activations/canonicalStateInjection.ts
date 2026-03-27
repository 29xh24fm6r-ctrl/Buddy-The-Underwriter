/**
 * Canonical State Injection — Phase 65C
 *
 * Shared helpers to inject BuddyCanonicalState + OmegaAdvisoryState
 * + BuddyExplanation into Stitch activation data and render as DOM elements.
 *
 * RULE: No surface computes lifecycle/readiness/next-step locally.
 * RULE: Buddy explains state. Omega explains reasoning. Never mixed.
 */

import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { getOmegaAdvisoryState } from "@/core/omega/OmegaAdvisoryAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { formatOmegaAdvisory } from "@/core/omega/formatOmegaAdvisory";
import type { BuddyCanonicalState } from "@/core/state/types";
import type { OmegaAdvisoryState } from "@/core/omega/types";
import type { BuddyExplanation } from "@/core/explanation/types";

export type CanonicalStatePayload = {
  canonicalState: BuddyCanonicalState | null;
  omega: OmegaAdvisoryState | null;
  explanation: BuddyExplanation | null;
};

/**
 * Fetch canonical state + omega advisory for a deal.
 * Returns null fields if dealId is missing.
 */
export async function fetchCanonicalStatePayload(
  dealId: string | null,
): Promise<CanonicalStatePayload> {
  if (!dealId) return { canonicalState: null, omega: null, explanation: null };

  try {
    const [state, omega] = await Promise.all([
      getBuddyCanonicalState(dealId),
      getOmegaAdvisoryState(dealId),
    ]);
    const explanation = deriveBuddyExplanation(state);
    return { canonicalState: state, omega, explanation };
  } catch (err) {
    console.error("[canonicalStateInjection] error:", err);
    return { canonicalState: null, omega: null, explanation: null };
  }
}

/**
 * IIFE script fragment that renders canonical state + omega into the Stitch DOM.
 * Appended to activation scripts. Reads from __stitch_activation_data__.
 */
export function buildCanonicalStateRenderScript(): string {
  return `
  // ── Canonical State + Omega Rendering (Phase 65A) ──
  (function renderCanonicalState() {
    var data = (function () {
      var el = document.getElementById("__stitch_activation_data__");
      if (!el) return null;
      try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
    })();
    if (!data) return;

    var cs = data.canonicalState;
    var omega = data.omega;
    if (!cs && !omega) return;

    // Find or create a header container
    var anchor = document.querySelector("header") || document.querySelector("main") || document.body;
    if (!anchor) return;

    var stateBar = document.createElement("div");
    stateBar.className = "flex flex-wrap items-center gap-3 px-4 py-2 mb-3 rounded-xl border border-blue-200/30 bg-blue-900/10";
    stateBar.setAttribute("data-canonical-state", "true");

    // Stage badge
    if (cs) {
      var stageBadge = document.createElement("span");
      stageBadge.className = "px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/15 bg-white/10 text-white";
      stageBadge.textContent = (cs.lifecycle || "").replace(/_/g, " ");
      stateBar.appendChild(stageBadge);

      // Next action
      if (cs.nextRequiredAction) {
        var nextLabel = document.createElement("span");
        nextLabel.className = "text-xs text-white/70";
        nextLabel.textContent = "Next: " + cs.nextRequiredAction.label;
        stateBar.appendChild(nextLabel);
      }

      // Blocker count
      if (cs.blockers && cs.blockers.length > 0) {
        var blockerBadge = document.createElement("span");
        blockerBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/30 bg-amber-600/20 text-amber-200";
        blockerBadge.textContent = cs.blockers.length + " blocker(s)";
        stateBar.appendChild(blockerBadge);
      }
    }

    // Omega confidence badge
    if (omega && omega.confidence >= 0) {
      var omegaBadge = document.createElement("span");
      var conf = omega.confidence;
      var omegaColor = omega.stale ? "border-neutral-400/30 bg-neutral-500/20 text-neutral-300"
        : conf >= 80 ? "border-emerald-500/30 bg-emerald-600/20 text-emerald-300"
        : conf >= 50 ? "border-amber-500/30 bg-amber-600/20 text-amber-200"
        : "border-red-500/30 bg-red-600/20 text-red-200";
      omegaBadge.className = "ml-auto px-2 py-0.5 rounded-full text-[11px] font-semibold border " + omegaColor;
      omegaBadge.textContent = omega.stale ? "Advisory outdated" : conf + "% confidence";
      omegaBadge.title = omega.stale ? (omega.staleReason || "Advisory may be outdated") : "Omega confidence: " + conf + "%";
      stateBar.appendChild(omegaBadge);
    }

    // Insert state bar
    if (anchor.firstChild) {
      anchor.insertBefore(stateBar, anchor.firstChild);
    } else {
      anchor.appendChild(stateBar);
    }

    // Buddy explanation panel (WHY + BLOCKING)
    var expl = data.explanation;
    if (expl) {
      var explPanel = document.createElement("div");
      explPanel.className = "px-4 py-3 mb-3 rounded-xl border border-neutral-200 bg-white space-y-2";
      explPanel.setAttribute("data-buddy-explanation", "true");

      // Summary
      var summaryEl = document.createElement("div");
      summaryEl.className = "text-sm font-medium text-neutral-900";
      summaryEl.textContent = expl.summary;
      explPanel.appendChild(summaryEl);

      // Reasons
      if (expl.reasons && expl.reasons.length > 0) {
        var reasonTitle = document.createElement("div");
        reasonTitle.className = "text-[10px] font-semibold uppercase tracking-wide text-neutral-500";
        reasonTitle.textContent = "Why";
        explPanel.appendChild(reasonTitle);
        expl.reasons.forEach(function (r) {
          var li = document.createElement("div");
          li.className = "text-xs text-neutral-700 pl-2";
          li.textContent = "· " + r;
          explPanel.appendChild(li);
        });
      }

      // Blocking factors
      if (expl.blockingFactors && expl.blockingFactors.length > 0) {
        var blockTitle = document.createElement("div");
        blockTitle.className = "text-[10px] font-semibold uppercase tracking-wide text-red-500";
        blockTitle.textContent = "Blocking";
        explPanel.appendChild(blockTitle);
        expl.blockingFactors.forEach(function (b) {
          var li = document.createElement("div");
          li.className = "text-xs text-red-700 pl-2";
          li.textContent = "· " + b;
          explPanel.appendChild(li);
        });
      }

      // Next action reason
      if (cs && cs.nextRequiredAction) {
        var nextEl = document.createElement("div");
        nextEl.className = "text-xs text-neutral-600 mt-1";
        nextEl.textContent = "Next: " + cs.nextRequiredAction.label;
        if (cs.nextRequiredAction.intent === "blocked") {
          nextEl.textContent += " (blocked)";
        }
        explPanel.appendChild(nextEl);
      }

      stateBar.parentNode.insertBefore(explPanel, stateBar.nextSibling);
    }

    // Omega advisory panel (if advisory text exists — SEPARATE from Buddy explanation)
    if (omega && omega.advisory) {
      var advisoryPanel = document.createElement("div");
      advisoryPanel.className = "px-4 py-3 mb-3 rounded-xl border " + (omega.stale ? "border-neutral-200 bg-neutral-50" : "border-blue-200 bg-blue-50");
      advisoryPanel.setAttribute("data-omega-advisory", "true");

      var advTitle = document.createElement("div");
      advTitle.className = "text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-1";
      advTitle.textContent = omega.stale ? "Omega Advisory (may be outdated)" : "Omega Advisory";
      advisoryPanel.appendChild(advTitle);

      var advText = document.createElement("div");
      advText.className = "text-sm text-neutral-700";
      advText.textContent = omega.advisory;
      advisoryPanel.appendChild(advText);

      if (omega.riskEmphasis && omega.riskEmphasis.length > 0) {
        var riskWrap = document.createElement("div");
        riskWrap.className = "flex flex-wrap gap-1.5 mt-2";
        omega.riskEmphasis.forEach(function (signal) {
          var chip = document.createElement("span");
          chip.className = "rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700";
          chip.textContent = signal;
          riskWrap.appendChild(chip);
        });
        advisoryPanel.appendChild(riskWrap);
      }

      stateBar.parentNode.insertBefore(advisoryPanel, stateBar.nextSibling);
    }
  })();
`;
}
