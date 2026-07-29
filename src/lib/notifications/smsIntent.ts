import { writeDealEvent } from "@/lib/events/dealEvents";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export async function emitSmsIntent(args: {
  dealId: string;
  to: string;
  template: "decision_finalized" | "evidence_needed";
  vars: Record<string, any>;
}) {
  const bankId = await getCurrentBankId();
  
  await writeDealEvent({
    dealId: args.dealId,
    bankId,
    kind: "notify.sms",
    actorRole: "system",
    title: `SMS intent: ${args.template}`,
    payload: { to: args.to, template: args.template, vars: args.vars },
  });
}
