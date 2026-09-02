/** Staff workspace routes. Never substitute the bank-facing /deals list. */
export const BROKERAGE_HOME = "/admin/brokerage";
export const BROKERAGE_WORKSPACE_LINKS = [
  { label: "Brokerage home", href: BROKERAGE_HOME },
  { label: "Brokerage deals", href: `${BROKERAGE_HOME}/pipeline` },
  { label: "CRM & follow-ups", href: `${BROKERAGE_HOME}/crm` },
  { label: "Lender placements", href: `${BROKERAGE_HOME}/crm/buyers` },
  { label: "Billing", href: `${BROKERAGE_HOME}/billing` },
  { label: "Team & access", href: `${BROKERAGE_HOME}/team` },
] as const;

export function brokerageAdminEntryPath(path?: string[]): string {
  return path?.length ? `/admin/${path.map(encodeURIComponent).join("/")}` : BROKERAGE_HOME;
}

export function activeBrokerageWorkspaceLink(pathname: string, items: readonly { href: string }[] = BROKERAGE_WORKSPACE_LINKS): string | undefined {
  return [...items]
    .sort((a, b) => b.href.length - a.href.length)
    .find(({ href }) => pathname === href || (href !== BROKERAGE_HOME && pathname.startsWith(`${href}/`)))?.href;
}
