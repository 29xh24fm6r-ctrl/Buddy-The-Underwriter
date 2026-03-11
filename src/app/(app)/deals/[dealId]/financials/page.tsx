import FinancialsClient from "./FinancialsClient";

type Props = {
  params: Promise<{ dealId: string }>;
};

export default async function FinancialsPage({ params }: Props) {
  const { dealId } = await params;
  return <FinancialsClient dealId={dealId} />;
}
