import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const { message } = await req.json();

  await writeAiEvent({
    deal_id: dealId,
    kind: "copilot.message",
    scope: "borrower",
    action: "ask",
    input_json: { message }
  });

  return NextResponse.json({
    reply: "You're missing one document to reach E-Tran readiness."
  });
}
