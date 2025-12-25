import DealShell from "./DealShell";

export default function DealIdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { dealId: string };
}) {
  return <DealShell dealId={params.dealId}>{children}</DealShell>;
}
