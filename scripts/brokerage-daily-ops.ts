#!/usr/bin/env tsx
import { buildDailyOpsReport } from "../src/lib/brokerage/dailyOps";
const js=process.argv.includes("--json");
const r=buildDailyOpsReport({now:new Date(),sessions:[],deals:[],concierges:[],stories:[],documents:[],scores:[],tridents:[],sealedPackages:[],listings:[],claims:[],picks:[],accesses:[],closingWorkflows:[],closingConditions:[],fundingVerifications:[],feeLedger:[],disclosures:[],form159Records:[]});
if(js)console.log(JSON.stringify(r,null,2));else console.log(`Status:${r.status} Crit:${r.criticalActions.length} Follow:${r.followups.length}`);
process.exit(r.status==="RED"?1:0);
