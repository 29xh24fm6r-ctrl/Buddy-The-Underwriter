export const REMINDER_POLICY = {
  // Only remind if last reminder was more than this many hours ago
  cooldownHours: 48,

  // Max reminder attempts per deal+borrower
  maxAttempts: 3,

  // If borrower has *any* SMS activity recently, you can choose to suppress reminders.
  // Keep it simple for v1: false (0 means disabled)
  suppressIfAnySmsInLastHours: 0,
} as const;
