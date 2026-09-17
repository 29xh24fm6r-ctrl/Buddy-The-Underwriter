const EVENTS = new Set([
  "borrower_journey_task_opened",
  "borrower_journey_answer_saved",
  "borrower_journey_save_failed",
]);
const CHAPTERS = new Set([
  "plan",
  "business",
  "numbers",
  "application",
  "review",
]);
const METHODS = new Set(["text", "voice"]);
/** Portal bearer URLs and borrower answers must never enter analytics. */
export function safeJourneyAnalytics<
  T extends { event: string; properties?: Record<string, any> },
>(event: T, pathname: string): T | null {
  if (pathname.startsWith("/portal/") || pathname.startsWith("/borrower/"))
    return null;
  if (pathname === "/start") {
    if (!EVENTS.has(event.event)) return null;
    const p = event.properties ?? {};
    return {
      ...event,
      properties: {
        ...(typeof p.distinct_id === "string"
          ? { distinct_id: p.distinct_id }
          : {}),
        ...(CHAPTERS.has(p.chapter) ? { chapter: p.chapter } : {}),
        ...(METHODS.has(p.input_method)
          ? { input_method: p.input_method }
          : {}),
      },
    };
  }
  // SDK initial/referrer properties can survive navigation away from a private link.
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !/url|referrer|pathname/i.test(key))
          .map(([key, v]) => [key, clean(v)]),
      );
    return value;
  };
  return { ...event, properties: clean(event.properties ?? {}) };
}
