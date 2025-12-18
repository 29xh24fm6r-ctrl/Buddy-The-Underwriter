// Autonomous Borrower Communications (Safe)
// All emails are drafted by AI, logged, and require human approval to send

export type EmailDraft = {
  subject: string;
  body: string;
  priority?: "LOW" | "NORMAL" | "HIGH";
  requires_approval: boolean;
};

export function draftMissingDocsEmail(missing: any[]): EmailDraft {
  const titles = missing.map((m) => m.title).join(", ");

  return {
    subject: "Documents needed to proceed with your SBA loan application",
    body: `Hello,

We're reviewing your SBA loan application and need the following documents to continue:

${missing.map((m, i) => `${i + 1}. ${m.title}`).join("\n")}

Please upload these documents through your secure borrower portal at your earliest convenience.

If you have any questions, please don't hesitate to reach out.

Best regards,
Your SBA Lending Team`,
    priority: "NORMAL",
    requires_approval: false, // Auto-send for standard doc requests
  };
}

export function draftPreflightFailureEmail(issues: any[]): EmailDraft {
  const blocking = issues.filter((i) => i.severity === "BLOCKING");

  return {
    subject: "Action needed: Items requiring attention on your SBA application",
    body: `Hello,

We've completed a preliminary review of your SBA loan application and identified some items that need your attention:

${blocking.map((issue, i) => `${i + 1}. ${issue.message}${issue.how_to_fix ? `\n   Resolution: ${issue.how_to_fix}` : ""}`).join("\n\n")}

Please review these items and update your application accordingly.

If you need assistance, please contact us through your borrower portal.

Best regards,
Your SBA Lending Team`,
    priority: "HIGH",
    requires_approval: true, // Human review for negative news
  };
}

export function draftReadyForReviewEmail(score: number): EmailDraft {
  return {
    subject: "Your SBA loan application is ready for review",
    body: `Hello,

Great news! Your SBA loan application has passed all automated checks and is now ready for underwriter review.

Application Readiness Score: ${score}/100

Our team will review your application shortly and reach out with next steps.

Thank you for your patience and for providing complete documentation.

Best regards,
Your SBA Lending Team`,
    priority: "NORMAL",
    requires_approval: false, // Auto-send for positive news
  };
}

export function draftApprovalEmail(loanAmount: number): EmailDraft {
  return {
    subject: "SBA loan approval - next steps",
    body: `Hello,

We're pleased to inform you that your SBA loan application has been approved for $${loanAmount.toLocaleString()}.

Our team will reach out shortly with closing documents and next steps.

Congratulations!

Best regards,
Your SBA Lending Team`,
    priority: "HIGH",
    requires_approval: true, // Always require approval for final decisions
  };
}
