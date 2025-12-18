// AI Draft Message Text
// CRITICAL: AI can ONLY draft text, NEVER change condition state

import { aiExplainCondition } from "@/lib/conditions/aiExplain";
import type { TriggerType } from "./triggers";

export type MessageDraft = {
  subject: string;
  body: string;
  channel: "EMAIL" | "PORTAL" | "SMS";
  priority: "HIGH" | "MEDIUM" | "LOW";
  ai_generated: true;
  metadata: {
    trigger_type: TriggerType;
    condition_title: string;
    ai_explanation: string;
  };
};

export function aiDraftMessage(
  condition: any,
  triggerType: TriggerType,
  context: { attachments?: any[]; requirements?: any; preflight?: any }
): MessageDraft {
  // Get AI explanation (read-only, doesn't change state)
  const aiExplanation = aiExplainCondition(condition, {
    ...context,
    attachments: context.attachments || []
  });

  // Draft subject based on trigger type
  const subject = generateSubject(condition, triggerType);

  // Draft body based on trigger type
  const body = generateBody(condition, triggerType, aiExplanation, context);

  // Determine priority from trigger
  const priority = determinePriority(triggerType, condition);

  return {
    subject,
    body,
    channel: "PORTAL", // Default to portal notifications
    priority,
    ai_generated: true,
    metadata: {
      trigger_type: triggerType,
      condition_title: condition.title,
      ai_explanation: aiExplanation,
    },
  };
}

function generateSubject(condition: any, triggerType: TriggerType): string {
  const subjectMap: Record<TriggerType, string> = {
    BLOCKING_HIGH: `Action Required: ${condition.title}`,
    MISSING_DOC: `Document Needed: ${condition.title}`,
    STALL_3D: `Reminder: ${condition.title}`,
    STALL_7D: `Important: ${condition.title} Still Pending`,
    STALL_14D: `URGENT: ${condition.title} Outstanding for 2+ Weeks`,
    NEWLY_REQUIRED: `New Item Added: ${condition.title}`,
    APPROACHING_DEADLINE: `Deadline Approaching: ${condition.title}`,
  };

  return subjectMap[triggerType] || `Update: ${condition.title}`;
}

function generateBody(
  condition: any,
  triggerType: TriggerType,
  aiExplanation: string,
  context: any
): string {
  const greeting = "Hello,\n\n";
  const signature = "\n\nBest regards,\nYour SBA Lending Team";

  let bodyContent = "";

  switch (triggerType) {
    case "BLOCKING_HIGH":
      bodyContent = `We're reviewing your SBA loan application and need your help to move forward.\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `${condition.description || ""}\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `This item is required before we can proceed to closing. Please address it at your earliest convenience.`;
      break;

    case "MISSING_DOC":
      bodyContent = `We need one more document to complete your SBA loan application.\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `Please upload this document through your secure borrower portal. If you have questions or need help, just reply to this message.`;
      break;

    case "STALL_3D":
      bodyContent = `Just checking in on your SBA loan application.\n\n`;
      bodyContent += `We're still waiting on:\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `No rush, but please let us know if you need any assistance or have questions.`;
      break;

    case "STALL_7D":
      bodyContent = `We wanted to follow up on an outstanding item for your SBA loan.\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `This has been pending for about a week. Is there anything we can help with? We're here to make this process as smooth as possible.`;
      break;

    case "STALL_14D":
      bodyContent = `**IMPORTANT:** We need your attention on a critical item for your SBA loan application.\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `This has been outstanding for over 2 weeks, and we want to help you move forward.\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `Please reach out to us as soon as possible so we can discuss next steps. We're committed to getting this done!`;
      break;

    case "NEWLY_REQUIRED":
      bodyContent = `Good news - we're making progress on your SBA loan application!\n\n`;
      bodyContent += `We've identified one additional item we need:\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `This is the last piece we need to move forward. Thank you for your patience!`;
      break;

    case "APPROACHING_DEADLINE":
      const daysUntilDue = condition.metadata?.days_until_due || "a few";
      bodyContent = `Quick heads up - you have an upcoming deadline for your SBA loan.\n\n`;
      bodyContent += `**${condition.title}**\n`;
      bodyContent += `Due in: ${daysUntilDue} day(s)\n\n`;
      bodyContent += `${aiExplanation}\n\n`;
      bodyContent += `Please complete this soon to avoid any delays. Let us know if you need help!`;
      break;

    default:
      bodyContent = `We have an update regarding your SBA loan application.\n\n`;
      bodyContent += `**${condition.title}**\n\n`;
      bodyContent += `${aiExplanation}`;
  }

  return greeting + bodyContent + signature;
}

function determinePriority(
  triggerType: TriggerType,
  condition: any
): "HIGH" | "MEDIUM" | "LOW" {
  if (triggerType === "BLOCKING_HIGH" || triggerType === "STALL_14D") {
    return "HIGH";
  }

  if (
    triggerType === "STALL_7D" ||
    triggerType === "APPROACHING_DEADLINE" ||
    condition.severity === "REQUIRED"
  ) {
    return "HIGH";
  }

  if (triggerType === "MISSING_DOC" || triggerType === "NEWLY_REQUIRED") {
    return "MEDIUM";
  }

  return "LOW";
}
