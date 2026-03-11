import RelationshipClient from "./RelationshipClient";

type Props = {
  params: Promise<{ dealId: string }>;
};

export default async function RelationshipPage({ params }: Props) {
  const { dealId } = await params;
  return <RelationshipClient dealId={dealId} />;
}
