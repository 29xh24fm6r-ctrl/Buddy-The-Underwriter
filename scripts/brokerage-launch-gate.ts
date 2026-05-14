#!/usr/bin/env tsx
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { runLaunchGate } from "../src/lib/brokerage/launchGate";
const sb=process.argv.includes("--skip-build"),st=process.argv.includes("--strict"),js=process.argv.includes("--json"),gi=process.argv.indexOf("--gate"),gate=gi>=0?process.argv[gi+1]:undefined;
async function main(){const r=await runLaunchGate({skipBuild:sb,strict:st,gate});if(js){console.log(JSON.stringify(r,null,2));}else{console.log("LAUNCH GATE");for(const g of r.gates)console.log(`[${g.status.toUpperCase()}] ${g.name} — ${g.details}`);console.log(`Verdict:${r.overall} Crit:${r.critical} Warn:${r.warning}`);if(r.firstRepair)console.log(`Next: ${r.firstRepair}`);}process.exit(r.overall==="LAUNCH_READY"?0:1);}
main().catch(e=>{console.error(e);process.exit(1)});
