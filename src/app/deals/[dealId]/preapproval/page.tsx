import PreapprovalSimulator from "@/components/preapproval/PreapprovalSimulator";

interface Props {
  params: Promise<{ dealId: string }>;
}

export default async function PreapprovalSimulatorPage({ params }: Props) {
  const { dealId } = await params;

  return <PreapprovalSimulator dealId={dealId} />;
}
