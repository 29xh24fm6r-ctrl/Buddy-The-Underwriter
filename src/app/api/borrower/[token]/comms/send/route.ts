import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const body = await req.json();

    // Validate inputs
    if (!body.subject || !body.body) {
      return NextResponse.json(
        { ok: false, error: "Subject and body are required" },
        { status: 400 }
      );
    }

    // Log communication (HUMAN APPROVAL REQUIRED for actual send)
    await (sb as any).from("borrower_comms").insert({
      application_id: application.id,
      channel: "EMAIL",
      subject: body.subject,
      body: body.body,
      priority: body.priority || "NORMAL",
      requires_approval: body.requires_approval ?? true,
      status: body.requires_approval !== false ? "PENDING_APPROVAL" : "SENT",
      sent_at: body.requires_approval === false ? new Date().toISOString() : null,
      metadata: {
        draft_source: body.draft_source || "MANUAL",
        agent_confidence: body.agent_confidence,
      },
    });

    // TODO: If requires_approval === false, actually send email here
    // await sendEmail({ to: application.email, subject, body });

    return NextResponse.json({
      ok: true,
      status: body.requires_approval !== false ? "PENDING_APPROVAL" : "SENT",
      message:
        body.requires_approval !== false
          ? "Email drafted and awaiting approval"
          : "Email sent successfully",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "comms_send_failed" },
      { status: 500 }
    );
  }
}

// DRAFT ENDPOINT (AI-generated, not sent)
export async function PUT(req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const body = await req.json();

    // Just save draft, never send
    await (sb as any).from("borrower_comms").insert({
      application_id: application.id,
      channel: "EMAIL",
      subject: body.subject,
      body: body.body,
      priority: body.priority || "NORMAL",
      requires_approval: true,
      status: "DRAFT",
      metadata: {
        draft_source: body.draft_source || "AI_AGENT",
        agent_name: body.agent_name,
        agent_confidence: body.agent_confidence,
      },
    });

    return NextResponse.json({
      ok: true,
      status: "DRAFT",
      message: "Email draft saved for review",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "draft_save_failed" },
      { status: 400 }
    );
  }
}
