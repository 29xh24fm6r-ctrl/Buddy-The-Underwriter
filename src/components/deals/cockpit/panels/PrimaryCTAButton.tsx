"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { usePrimaryCTA, type PrimaryCTA } from "../hooks/usePrimaryCTA";
import { useArtifactActions } from "../hooks/useArtifactActions";

type Props = {
  dealId: string;
  onServerAction?: (action: string) => void;
  onAdvance?: () => void;
};

function getButtonStyles(cta: PrimaryCTA) {
  switch (cta.intent) {
    case "upload":
      return "bg-gradient-to-r from-sky-500 to-blue-500 text-white hover:from-sky-400 hover:to-blue-400 shadow-lg shadow-sky-500/20";
    case "recognize_retry":
      return "bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/20";
    case "processing":
      return "bg-gradient-to-r from-amber-500/50 to-orange-500/50 text-white/80 animate-pulse";
    case "advance":
    case "runnable":
      return "bg-gradient-to-r from-sky-500 to-emerald-500 text-white hover:from-sky-400 hover:to-emerald-400 shadow-lg shadow-sky-500/20";
    case "navigate":
      return "bg-gradient-to-r from-sky-500/80 to-blue-500/80 text-white hover:from-sky-400/80 hover:to-blue-400/80";
    case "blocked":
      return "bg-white/5 text-white/30 cursor-not-allowed border border-white/10";
    case "complete":
      return "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 cursor-default";
    default:
      return "bg-white/5 text-white/40";
  }
}

export function PrimaryCTAButton({ dealId, onServerAction, onAdvance }: Props) {
  const router = useRouter();
  const { lifecycleState, artifactSummary } = useCockpitDataContext();
  const { isProcessing, triggerRecognize } = useArtifactActions(dealId);
  const cta = usePrimaryCTA(dealId, lifecycleState, artifactSummary, isProcessing);

  const handleClick = async () => {
    if (cta.disabled) return;

    switch (cta.intent) {
      case "upload":
      case "navigate":
        if (cta.href) {
          // If targeting documents section on current page, scroll to it
          if (cta.href.includes("focus=documents")) {
            const el = document.getElementById("cockpit-documents");
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
              return;
            }
          }
          router.push(cta.href);
        }
        break;
      case "recognize_retry":
        await triggerRecognize();
        break;
      case "runnable":
        if (cta.serverAction && onServerAction) {
          onServerAction(cta.serverAction);
        } else if (cta.href) {
          router.push(cta.href);
        }
        break;
      case "advance":
        if (cta.shouldAdvance && onAdvance) {
          onAdvance();
        } else if (cta.href) {
          router.push(cta.href);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleClick}
        disabled={cta.disabled}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
          getButtonStyles(cta),
        )}
      >
        <span
          className={cn(
            "material-symbols-outlined text-[20px]",
            cta.animate && "animate-spin",
          )}
        >
          {cta.icon}
        </span>
        {cta.label}
      </button>
      {cta.description && (
        <div className="text-[10px] text-white/40 text-center">{cta.description}</div>
      )}
    </div>
  );
}
