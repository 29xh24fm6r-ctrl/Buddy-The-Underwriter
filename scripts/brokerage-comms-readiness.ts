#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { runReadinessCheck } from "../src/lib/brokerage/commsRollout";
const { exitCode, readiness } = runReadinessCheck();
console.log(`COMMS READINESS — Mode: ${readiness.mode} — Status: ${readiness.status.toUpperCase()}`);
for (const i of readiness.items) console.log(`  [${i.status.toUpperCase()}] ${i.name}: ${i.detail}`);
process.exit(exitCode);
