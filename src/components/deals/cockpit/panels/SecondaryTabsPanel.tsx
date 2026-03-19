"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SafeBoundary } from "@/components/SafeBoundary";
import DealIntakeCard from "@/components/deals/DealIntakeCard";
import BorrowerAttachmentCard from "@/components/deals/BorrowerAttachmentCard";
import BorrowerRequestComposerCard from "@/components/deals/BorrowerRequestComposerCard";
import BorrowerUploadLinksCard from "@/components/deals/BorrowerUploadLinksCard";
import { UnderwritingControlPanel } from "@/components/deals/UnderwritingControlPanel";
import StoryPanel from "@/components/deals/cockpit/panels/StoryPanel";
import { DocumentsTabPanel } from "@/components/deals/cockpit/panels/DocumentsTabPanel";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import { PreviewUnderwritePanel } from "@/components/deals/PreviewUnderwritePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { LoanRequestsSection } from "@/components/loanRequests/LoanRequestsSection";
import { IntakeReviewTable } from "@/components/deals/intake/IntakeReviewTable";
import RiskDashboardPanel from "@/components/deals/cockpit/panels/RiskDashboardPanel";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type VerifyLedgerEvent = {
  status: "pass" | "fail";
  source: "builder" | "runtime";
  details: {
    url: string;
    httpStatus?: number;
    auth?: boolean;
    html?: boolean;
    metaFallback?: boolean;
    error?: string;
    redacted?: boolean;
  };
  recommendedNextAction?: string | null;
  diagnostics?: Record<string, unknown> | null;
  createdAt?: string | null;
};

const TABS = [
  { key: "setup",        label: "Setup",        icon: "settings" },
  { key: "story",        label: "Story",        icon: "auto_stories" },
  { key: "documents",    label: "Documents",    icon: "folder_open" },
  { key: "underwriting", label: "Underwriting", icon: "analytics" },
  { key: "timeline",     label: "Timeline",     icon: "timeline" },
] as const;

const ADMIN_TAB = { key: "admin" as const, label: "Admin", icon: "admin_panel_settings" };
const INTAKE_TAB = { key: "intake" as const, label: "Intake Review", icon: "fact_check" };

type TabKey = (typeof TABS)[number]["key"] | "admin" | "intake";

const VALID_TAB_KEYS = new Set<string>(TABS.map((t) => t.key));
// Admin + Intake are conditionally valid but always recognized for URL parsing
VALID_TAB_KEYS.add("admin");
VALID_TAB_KEYS.add("intake");

type Props = {
  dealId: string;
  isAdmin?: boolean;
  lifecycleStage?: string | null;
  intakeInitialized?: boolean;
  intakePhase?: string | null;
  intakeGateEnabled?: boolean;
  verify: VerifyUnderwriteResult;
  verifyLedger?: VerifyLedgerEvent | null;
  unifiedLifecycleState?: any;
  onLifecycleStageChange?: (stage: string | null) => void;
  gatekeeperPrimaryRouting?: boolean;
};

function BorrowerPortalCollapsed({ dealId, lifecycleStage }: { dealId: string; lifecycleStage: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02]">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-white/40 hover:text-white/60">
        <span>Borrower Portal</span>
        <span className="material-symbols-outlined text-[14px]">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <SafeBoundary><BorrowerRequestComposerCard dealId={dealId} /></SafeBoundary>
          <SafeBoundary><BorrowerUploadLinksCard dealId={dealId} lifecycleStage={lifecycleStage} /></SafeBoundary>
        </div>
      )}
    </div>
  );
}

export function SecondaryTabsPanel({
  dealId,
  isAdmin,
  lifecycleStage,
  intakeInitialized,
  intakePhase,
  intakeGateEnabled = false,
  verify,
  verifyLedger,
  unifiedLifecycleState,
  onLifecycleStageChange,
  gatekeeperPrimaryRouting = false,
}: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = searchParams?.get("tab") as TabKey | null;
  const defaultTab: TabKey = (() => {
    if (urlTab && VALID_TAB_KEYS.has(urlTab)) return urlTab;
    if (!intakeGateEnabled) return intakePhase ? "story" : "setup";
    if (intakePhase === "CLASSIFIED_PENDING_CONFIRMATION") return "intake";
    return intakePhase ? "story" : "setup";
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const panelRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  // Sync active tab when URL ?tab= param changes externally (e.g. CTA click)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (urlTab && VALID_TAB_KEYS.has(urlTab)) {
      setActiveTab(urlTab);
      // Scroll the panel into view so user sees the activated tab
      requestAnimationFrame(() => {
        try {
          panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch { /* guard against parentNode null during React unmount */ }
      });
    } else if (urlTab && !VALID_TAB_KEYS.has(urlTab)) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[Cockpit] Unknown tab param: "${urlTab}". Valid tabs: ${[...VALID_TAB_KEYS].join(", ")}`,
        );
      }
    }
  }, [urlTab]);

  const showIntakeTab = intakePhase != null && intakePhase !== "CONFIRMED_READY_FOR_PROCESSING";
  const tabs = [
    ...TABS,
    ...(showIntakeTab ? [INTAKE_TAB] : []),
    ...(isAdmin ? [ADMIN_TAB] : []),
  ];

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    // Update URL for deep linking without full navigation
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div ref={panelRef} id="secondary-tabs-panel" className={cn(glassPanel, "overflow-hidden")}>
      {/* Tab header */}
      <div className={glassHeader}>
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                activeTab === tab.key
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/60 hover:bg-white/5",
              )}
            >
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 space-y-4">
        {activeTab === "setup" && (
          <>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Setup</h3>
            <SafeBoundary>
              <DealIntakeCard
                dealId={dealId}
                isAdmin={isAdmin ?? false}
                lifecycleStage={lifecycleStage ?? null}
                onLifecycleStageChange={onLifecycleStageChange}
              />
            </SafeBoundary>
            <SafeBoundary>
              <LoanRequestsSection dealId={dealId} />
            </SafeBoundary>
            <SafeBoundary>
              <BorrowerAttachmentCard dealId={dealId} />
            </SafeBoundary>
            <BorrowerPortalCollapsed dealId={dealId} lifecycleStage={lifecycleStage ?? null} />
          </>
        )}

        {activeTab === "story" && (
          <>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Deal Story</h3>
            <SafeBoundary><StoryPanel dealId={dealId} /></SafeBoundary>
          </>
        )}

        {activeTab === "documents" && (
          <>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Documents</h3>
            <SafeBoundary><DocumentsTabPanel dealId={dealId} isAdmin={isAdmin} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} /></SafeBoundary>
          </>
        )}

        {activeTab === "underwriting" && (
          <>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Underwriting</h3>
            <SafeBoundary>
              <RiskDashboardPanel dealId={dealId} />
            </SafeBoundary>
            <SafeBoundary>
              <UnderwritingControlPanel
                dealId={dealId}
                lifecycleStage={lifecycleStage ?? null}
                intakeInitialized={intakeInitialized}
                verifyLedger={verifyLedger ?? null}
              />
            </SafeBoundary>
            <SafeBoundary>
              <DealOutputsPanel dealId={dealId} verify={verify} />
            </SafeBoundary>
            <SafeBoundary>
              <PreviewUnderwritePanel dealId={dealId} />
            </SafeBoundary>
            <a href={`/deals/${dealId}/spreads`} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/10 w-full justify-center mt-2">
              <span className="material-symbols-outlined text-[14px]">table_chart</span>
              View Classic Spreads
            </a>
          </>
        )}

        {activeTab === "timeline" && (
          <>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Timeline</h3>
            <SafeBoundary>
              <DealStoryTimeline dealId={dealId} />
            </SafeBoundary>
          </>
        )}

        {activeTab === "intake" && showIntakeTab && (
          <SafeBoundary>
            <IntakeReviewTable dealId={dealId} />
          </SafeBoundary>
        )}

        {activeTab === "admin" && isAdmin && (
          <SafeBoundary>
            <ForceAdvancePanel
              dealId={dealId}
              currentStage={unifiedLifecycleState?.stage ?? lifecycleStage}
            />
          </SafeBoundary>
        )}
      </div>
    </div>
  );
}
