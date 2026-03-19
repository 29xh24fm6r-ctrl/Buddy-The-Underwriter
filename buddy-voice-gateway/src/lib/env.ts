import { config } from "dotenv";
config();

export function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export function envOptional(key: string): string | undefined {
  return process.env[key];
}
