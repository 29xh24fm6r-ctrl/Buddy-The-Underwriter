import OpenAI from "openai";

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  return new OpenAI({ apiKey });
}

export function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-2024-08-06";
}

export function getTemp() {
  const v = Number(process.env.OPENAI_TEMPERATURE ?? "0.2");
  return Number.isFinite(v) ? v : 0.2;
}

export function getMaxOutputTokens() {
  const v = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? "4096");
  return Number.isFinite(v) ? v : 4096;
}
