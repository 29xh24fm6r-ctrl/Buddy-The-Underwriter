#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { runLivePreflight } from "../src/lib/brokerage/commsRollout";
const r = runLivePreflight();
console.log(`COMMS LIVE PREFLIGHT — Mode: ${r.mode}`);
if (r.error) { console.log(`Error: ${r.error}`); process.exit(1); }
console.log(`Release ready: ${r.releaseReady}`);
console.log(`Cron: ${r.cronConfigured ? "configured" : "missing"}`);
if (r.wouldEnable.length > 0) { console.log("Would enable:"); for (const w of r.wouldEnable) console.log(`  + ${w}`); }
if (r.blocked.length > 0) { console.log("Blocked:"); for (const b of r.blocked) console.log(`  !! ${b}`); }
console.log(r.ok ? "PREFLIGHT PASSED" : "PREFLIGHT BLOCKED");
process.exit(r.ok ? 0 : 1);
