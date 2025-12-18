import SimplePortalClient from "./SimplePortalClient";

export default async function SimplePortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SimplePortalClient token={token} />;
}
