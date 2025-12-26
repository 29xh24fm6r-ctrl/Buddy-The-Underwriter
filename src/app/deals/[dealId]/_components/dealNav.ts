export type DealNavItem = {
  key: string;
  label: string;
  href: (dealId: string) => string;
  icon?: string; // material symbols key (optional)
};

export const DEAL_NAV: DealNavItem[] = [
  { key: "overview", label: "Overview", href: (id) => `/deals/${id}`, icon: "dashboard" },
  { key: "underwriting", label: "Underwriting", href: (id) => `/deals/${id}/underwriting`, icon: "fact_check" },
  { key: "documents", label: "Documents", href: (id) => `/deals/${id}/documents`, icon: "folder_open" },
  { key: "risk", label: "Risk & Pricing", href: (id) => `/deals/${id}/risk`, icon: "bar_chart" },
  { key: "memo", label: "Memo", href: (id) => `/deals/${id}/memo`, icon: "description" },
  { key: "audit", label: "Audit", href: (id) => `/deals/${id}/audit`, icon: "policy" },
];
