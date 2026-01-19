export type StitchSurfaceKey =
  | "deal_command"
  | "underwrite"
  | "credit_committee"
  | "borrower_portal"
  | "portfolio"
  | "deal_intake";

export type StitchSurfaceConfig = {
  key: StitchSurfaceKey;
  route: string;
  required: boolean;
  owner: "banker" | "borrower" | "admin";
  mode: "iframe" | "new_tab" | "panel";
  slug?: string;
  openHref?: string;
  activation?: "dealId" | "token";
  pagePath?: string;
  notes?: string;
};

export const STITCH_SURFACES: StitchSurfaceConfig[] = [
  {
    key: "deal_command",
    route: "/deals/[dealId]/command",
    required: true,
    owner: "banker",
    mode: "panel",
    slug: "command-center-latest",
    pagePath: "src/app/(app)/deals/[dealId]/command/StitchPanel.tsx",
    notes: "Command surface uses panel mode to avoid duplicate CTAs.",
  },
  {
    key: "underwrite",
    route: "/underwrite",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "deals-command-bridge",
    pagePath: "src/app/(app)/underwrite/page.tsx",
  },
  {
    key: "credit_committee",
    route: "/deals/[dealId]/committee",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "deal-summary",
    pagePath: "src/app/(app)/deals/[dealId]/committee/CommitteeView.tsx",
  },
  {
    key: "borrower_portal",
    route: "/borrower/portal",
    required: true,
    owner: "borrower",
    mode: "iframe",
    slug: "borrower-document-upload-review",
    activation: "token",
    pagePath: "src/app/(app)/borrower/portal/page.tsx",
  },
  {
    key: "portfolio",
    route: "/portfolio",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "portfolio-command-bridge",
    pagePath: "src/app/(app)/portfolio/page.tsx",
  },
  {
    key: "deal_intake",
    route: "/intake",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "deal-intake-console",
    pagePath: "src/app/(app)/intake/page.tsx",
  },
];

export function getStitchSurfaceConfig(key: StitchSurfaceKey): StitchSurfaceConfig | null {
  return STITCH_SURFACES.find((surface) => surface.key === key) ?? null;
}
