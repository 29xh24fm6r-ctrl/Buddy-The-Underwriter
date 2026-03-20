"use client";

import type { BuilderStepKey, BuilderState, ServerFlags, BuilderPrefill } from "@/lib/builder/builderTypes";
import type { CollateralItem, ProceedsItem } from "@/lib/builder/builderTypes";
import { OverviewWorkspace } from "./workspaces/OverviewWorkspace";
import { PartiesWorkspace } from "./workspaces/PartiesWorkspace";
import { LoanRequestWorkspace } from "./workspaces/LoanRequestWorkspace";
import { FinancialsWorkspace } from "./workspaces/FinancialsWorkspace";
import { CollateralWorkspace } from "./workspaces/CollateralWorkspace";
import { RiskWorkspace } from "./workspaces/RiskWorkspace";
import { DocumentsWorkspace } from "./workspaces/DocumentsWorkspace";
import { StoryWorkspace } from "./workspaces/StoryWorkspace";
import { ReviewWorkspace } from "./workspaces/ReviewWorkspace";

type Props = {
  activeStep: BuilderStepKey;
  state: BuilderState;
  serverFlags: ServerFlags;
  prefill: BuilderPrefill | null;
  dealId: string;
  dealName: string;
  onSectionChange: (sectionKey: string, data: Record<string, unknown>) => void;
  onCollateralAdd: (item: Omit<CollateralItem, "id" | "deal_id" | "created_at" | "updated_at">) => void;
  onCollateralUpdate: (id: string, item: Partial<CollateralItem>) => void;
  onCollateralDelete: (id: string) => void;
  onProceedsAdd: (item: Omit<ProceedsItem, "id" | "deal_id" | "created_at">) => void;
  onProceedsDelete: (id: string) => void;
  onStepNavigate: (step: BuilderStepKey) => void;
};

export function BuilderWorkspace(props: Props) {
  switch (props.activeStep) {
    case "overview":
      return (
        <OverviewWorkspace
          state={props.state}
          serverFlags={props.serverFlags}
          dealId={props.dealId}
          dealName={props.dealName}
          onStepNavigate={props.onStepNavigate}
        />
      );
    case "parties":
      return (
        <PartiesWorkspace
          state={props.state}
          prefill={props.prefill}
          onSectionChange={props.onSectionChange}
        />
      );
    case "loan_request":
      return (
        <LoanRequestWorkspace
          state={props.state}
          prefill={props.prefill}
          onSectionChange={props.onSectionChange}
          dealId={props.dealId}
          proceeds={props.state.proceeds}
          onProceedsAdd={props.onProceedsAdd}
          onProceedsDelete={props.onProceedsDelete}
        />
      );
    case "financials":
      return <FinancialsWorkspace dealId={props.dealId} serverFlags={props.serverFlags} />;
    case "collateral":
      return (
        <CollateralWorkspace
          collateral={props.state.collateral}
          requestedAmount={(props.state.sections.deal as any)?.requested_amount ?? 0}
          onAdd={props.onCollateralAdd}
          onUpdate={props.onCollateralUpdate}
          onDelete={props.onCollateralDelete}
        />
      );
    case "risk":
      return <RiskWorkspace dealId={props.dealId} serverFlags={props.serverFlags} />;
    case "documents":
      return <DocumentsWorkspace dealId={props.dealId} serverFlags={props.serverFlags} />;
    case "story":
      return (
        <StoryWorkspace
          state={props.state}
          prefill={props.prefill}
          onSectionChange={props.onSectionChange}
        />
      );
    case "review":
      return (
        <ReviewWorkspace
          state={props.state}
          serverFlags={props.serverFlags}
          dealId={props.dealId}
        />
      );
    default:
      return null;
  }
}
