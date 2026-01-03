/**
 * DealPageWithTesting — Complete example with test mode
 * 
 * Shows how to integrate:
 * - Real DealNarrator
 * - Test control panel (internal only)
 * - State simulation
 * - Safe exploration
 * 
 * Usage:
 *   Add ?__mode=test to URL (internal users only)
 *   Control panel appears
 *   Click any state → see that UI
 *   Click "Reset to Real" → back to actual state
 */

"use client";

import { useEffect, useState } from "react";
import { DealNarrator } from "./DealNarrator";
import { DealRemaining } from "./DealRemaining";
import { DealEvidence } from "./DealEvidence";
import { TimeSignal } from "./TimeSignal";
import { TestControlPanel } from "@/components/internal/TestControlPanel";
import { DealMode } from "@/lib/deals/dealMode";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";
import { simulateDealMode, parseSimulatedMode } from "@/lib/testing/simulateDealMode";
import { getClientTestContext } from "@/lib/testing/getTestContext";

interface DealPageWithTestingProps {
  dealId: string;
}

export function DealPageWithTesting({ dealId }: DealPageWithTestingProps) {
  const [realMode, setRealMode] = useState<DealMode>("initializing");
  const [simulatedMode, setSimulatedMode] = useState<DealMode | null>(null);
  const [remainingItems, setRemainingItems] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [isTestMode, setIsTestMode] = useState(false);

  // Detect test mode
  useEffect(() => {
    setIsTestMode(getClientTestContext());

    // Parse initial simulation from URL
    const params = new URLSearchParams(window.location.search);
    const initialSim = parseSimulatedMode(params);
    if (initialSim) {
      setSimulatedMode(initialSim);
    }
  }, []);

  const fetchState = async () => {
    try {
      const checklistRes = await fetch(`/api/deals/${dealId}/checklist`);
      const checklistData = await checklistRes.json();

      if (!checklistData.ok) {
        console.error("Failed to load checklist:", checklistData.error);
        return;
      }

      const docsRes = await fetch(`/api/deals/${dealId}/documents`);
      const docsData = await docsRes.json();

      if (docsData.ok) {
        setDocuments(docsData.documents || []);
      }

      const derivedMode = deriveDealMode({
        checklist: {
          state: checklistData.state || "empty",
          pending: checklistData.items?.filter((item: any) => !item.is_satisfied).length || 0,
        },
        uploads: {
          processing: 0,
        },
      });

      setRealMode(derivedMode);
      setRemainingItems(
        checklistData.items?.filter((item: any) => !item.is_satisfied) || []
      );
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Error fetching deal state:", err);
    }
  };

  useEffect(() => {
    fetchState();

    const interval = setInterval(fetchState, 15000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchState();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [dealId]);

  // Display mode = simulated OR real
  const displayMode = simulateDealMode(realMode, simulatedMode);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 px-6 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <TimeSignal timestamp={lastUpdate.toISOString()} />

        <DealNarrator mode={displayMode} />

        {remainingItems.length > 0 && <DealRemaining items={remainingItems} />}

        <DealEvidence docs={documents.map(d => ({
          id: d.id,
          display_name: d.name || d.display_name,
          checklist_key: d.checklist_key,
          matched: d.matched,
        }))} />
      </div>

      {/* Test Control Panel (INTERNAL ONLY) */}
      {isTestMode && (
        <TestControlPanel
          onSimulate={setSimulatedMode}
          currentMode={realMode}
          simulatedMode={simulatedMode}
        />
      )}
    </div>
  );
}
