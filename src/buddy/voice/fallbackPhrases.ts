import { variantPick } from "./phraseVariants";

const ACK_A = ["Got it.", "Okay — I see that.", "Yep, I’ve got that."];
const ACK_B = ["All set.", "Yep — I see it.", "Perfect, I’ve got it."];

const ORIENT_A = [
  "Let me walk you through what I’m seeing.",
  "Here’s where things stand right now.",
  "Based on what I have so far…",
];
const ORIENT_B = [
  "Here’s what I’m seeing on my side.",
  "Quick status check:",
  "Here’s the current picture…",
];

export const FALLBACK_ACKNOWLEDGEMENTS = variantPick(ACK_A, ACK_B);
export const FALLBACK_ORIENTATIONS = variantPick(ORIENT_A, ORIENT_B);

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
