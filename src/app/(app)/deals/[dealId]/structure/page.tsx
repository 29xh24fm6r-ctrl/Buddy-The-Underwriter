import StructureClient from "./StructureClient";

type Props = {
  params: Promise<{ dealId: string }>;
};

export default async function StructurePage({ params }: Props) {
  const { dealId } = await params;
  return <StructureClient dealId={dealId} />;
}
