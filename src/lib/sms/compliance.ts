import "server-only";

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);
const START_WORDS = new Set(["START", "YES", "UNSTOP"]);

export function normalizeInboundBody(body: string) {
  return (body || "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function isStop(bodyNorm: string) {
  return STOP_WORDS.has(bodyNorm);
}

export function isHelp(bodyNorm: string) {
  return HELP_WORDS.has(bodyNorm);
}

export function isStart(bodyNorm: string) {
  return START_WORDS.has(bodyNorm);
}

export function twiml(message?: string) {
  if (!message) return `<Response></Response>`;
  // Minimal compliant TwiML; Twilio accepts <Message> with text
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<Response><Message>${escaped}</Message></Response>`;
}

export function stopReply() {
  return "You've been unsubscribed. No more messages from Buddy. Reply START to resubscribe.";
}

export function helpReply() {
  return "Buddy Underwriting SMS. Reply STOP to opt out. Reply START to resubscribe. Support: support@buddy.com";
}

export function startReply() {
  return "You're resubscribed to Buddy Underwriting SMS. Reply STOP to opt out.";
}
