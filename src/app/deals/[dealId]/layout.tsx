import DealShell from "./DealShell";

export default async function DealIdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
return <DealShell dealId={dealId}>{children}</DealShell>;
}
