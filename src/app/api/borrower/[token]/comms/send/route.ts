import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { getEmailProvider } from "@/lib/email/getProvider";

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

    // Check if immediate send or requires approval
    const shouldSendNow = body.requires_approval === false;
    
    let emailSent = false;
    let emailError = null;

    // If immediate send, use email provider
    if (shouldSendNow && application.contact_email) {
      try {
        const provider = getEmailProvider();
        const from = process.env.EMAIL_FROM || "noreply@buddy.com";
        await provider.send({
          to: application.contact_email,
          from,
          subject: body.subject,
          text: body.body,
        });
        emailSent = true;
      } catch (error: any) {
        console.error("[comms/send] email error:", error);
        emailError = error.message;
      }
    }

    // Log communication
    await (sb as any).from("borrower_comms").insert({
      application_id: application.id,
      channel: "EMAIL",
      subject: body.subject,
      body: body.body,
      priority: body.priority || "NORMAL",
      requires_approval: !shouldSendNow,
      status: emailSent ? "SENT" : shouldSendNow ? "FAILED" : "PENDING_APPROVAL",
      sent_at: emailSent ? new Date().toISOString() : null,
      metadata: {
        draft_source: body.draft_source || "MANUAL",
        agent_confidence: body.agent_confidence,
        email_error: emailError,
      },
    });

    if (shouldSendNow && !emailSent) {
      return NextResponse.json(
        { ok: false, error: emailError || "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      status: emailSent ? "SENT" : "PENDING_APPROVAL",
      message: emailSent
        ? "Email sent successfully"
        : "Email drafted and awaiting approval",
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
