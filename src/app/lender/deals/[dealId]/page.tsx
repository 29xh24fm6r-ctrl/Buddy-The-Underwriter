import LenderDealViewClient from "./LenderDealViewClient";

export default async function LenderDealPage(ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  return <LenderDealViewClient dealId={dealId} />;
}
