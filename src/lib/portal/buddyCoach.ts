// src/lib/portal/buddyCoach.ts

export type BuddyRecommendation = {
  priority: "high" | "medium" | "low";
  title: string;
  message: string;
  actionable: boolean;
  nextSteps?: string[];
};

export type BuddyMood =
  | "anxious"
  | "confused"
  | "motivated"
  | "accomplished"
  | "stuck"
  | "celebration";

export function detectMood(params: {
  percent: number;
  missingSeverity: number;
  recentActivity: boolean;
  timeStalled: number;
}): BuddyMood {
  if (params.percent >= 100) return "celebration";
  if (params.percent >= 70 && params.recentActivity) return "motivated";
  if (params.percent < 20 && !params.recentActivity) return "anxious";
  if (params.missingSeverity > 3 || params.timeStalled > 48) return "stuck";
  if (params.percent < 40) return "confused";
  return "motivated";
}

export function generateRecommendations(params: {
  missing: Array<{ code: string; title: string; description: string | null; required: boolean }>;
  receiptsCount: number;
  percent: number;
  mood: BuddyMood;
}): BuddyRecommendation[] {
  const recs: BuddyRecommendation[] = [];
  const { missing, receiptsCount, percent, mood } = params;

  // Primary recommendation: what to upload next
  if (missing.length > 0) {
    const nextItem = missing[0];
    recs.push({
      priority: "high",
      title: `Next best upload: ${nextItem.title}`,
      message:
        mood === "anxious"
          ? `I know paperwork feels overwhelming. Let's start with just one thing: ${nextItem.title}. You don't need to understand it — just upload what you have.`
          : mood === "confused"
            ? `If you're not sure what "${nextItem.title}" means, that's totally normal. Most people aren't. Upload anything that looks like a financial document and we'll figure it out together.`
            : `The fastest path forward: upload ${nextItem.title}. ${nextItem.description ?? "We'll handle the rest."}`,
      actionable: true,
      nextSteps: [
        "Look for anything with numbers, dates, or official letterhead",
        "Don't worry about perfect naming — we match intelligently",
        "If you can't find it, message us — we'll help or suggest alternatives",
      ],
    });
  }

  // Progress-based encouragement
  if (percent >= 70) {
    recs.push({
      priority: "medium",
      title: "You're almost done",
      message: `${missing.length} items left. You've already done the hard part — finishing this will feel amazing.`,
      actionable: false,
    });
  } else if (percent >= 35 && percent < 70) {
    recs.push({
      priority: "medium",
      title: "Solid progress",
      message: `You're ${percent}% done. Each upload gets you closer. No rush — go at your own pace.`,
      actionable: false,
    });
  } else if (receiptsCount === 0) {
    recs.push({
      priority: "high",
      title: "Getting started",
      message: `Upload any document you have — tax returns, bank statements, anything financial. We'll auto-check your list and guide you from there.`,
      actionable: true,
      nextSteps: [
        "Tax returns are usually the best first upload",
        "Bank statements work great too",
        "Don't have either? Message us — we'll find alternatives",
      ],
    });
  }

  // "Can't find it" alternative flows
  if (missing.length > 0) {
    recs.push({
      priority: "low",
      title: "Can't find something?",
      message: `If you're missing any documents, message us. We almost always have alternatives:`,
      actionable: true,
      nextSteps: [
        "Tax returns → We can use bank statements + P&L instead",
        "Financial statements → We can build them from your books",
        "Appraisals → We can order them for you",
      ],
    });
  }

  return recs;
}

export function celebrationMessage(percent: number): string | null {
  if (percent >= 100) {
    return "🎉 You did it! All required documents received. We'll review everything and message you with next steps. This usually takes 1–2 business days.";
  }
  if (percent >= 90) {
    return "🌟 Almost there! One or two more uploads and you're done.";
  }
  if (percent >= 75) {
    return "🔥 You're crushing it. Just a few more documents.";
  }
  if (percent >= 50) {
    return "💪 Halfway done! You're making great progress.";
  }
  if (percent >= 25) {
    return "✨ Awesome start! Each upload is a level-up.";
  }
  return null;
}

export function empatheticTone(mood: BuddyMood): {
  greeting: string;
  reassurance: string;
  tone: string;
} {
  switch (mood) {
    case "anxious":
      return {
        greeting: "Hey — I get it, this feels like a lot",
        reassurance:
          "You don't need to understand credit or lending. Just upload what you have, and I'll guide you through the rest. No judgment, no pressure.",
        tone: "calm",
      };
    case "confused":
      return {
        greeting: "Questions are good",
        reassurance:
          "Most people have never done this before. If something doesn't make sense, that's normal. Ask me anything — there's no such thing as a dumb question here.",
        tone: "patient",
      };
    case "stuck":
      return {
        greeting: "Let's unstick this",
        reassurance:
          "If you're stuck on a document, we almost always have workarounds. Message me what you're missing and I'll suggest alternatives.",
        tone: "problem-solving",
      };
    case "motivated":
      return {
        greeting: "You're doing great",
        reassurance:
          "Keep this momentum — you're on track. Each upload brings you closer to approval.",
        tone: "encouraging",
      };
    case "accomplished":
      return {
        greeting: "Nice work",
        reassurance: "You've handled the hard part. We'll take it from here.",
        tone: "celebratory",
      };
    case "celebration":
      return {
        greeting: "🎉 You did it!",
        reassurance:
          "All required documents received. We're reviewing everything now — expect an update in 1–2 business days.",
        tone: "victorious",
      };
  }
}
