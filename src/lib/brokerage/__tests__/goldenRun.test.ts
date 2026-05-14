import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { runGoldenBrokerageRun, cleanupGoldenRun } = require("../goldenRun") as typeof import("../goldenRun");
type Row = Record<string, any>;
class GS {
  tables: Record<string,Row[]>;
  constructor(){this.tables={deals:[],borrower_concierge_sessions:[],borrower_applications:[],deal_financial_facts:[],deal_borrower_story:[],deal_documents:[],buddy_sba_scores:[],buddy_trident_bundles:[],buddy_sealed_packages:[],marketplace_listings:[],marketplace_claims:[],marketplace_picks:[],marketplace_package_access:[],marketplace_audit_log:[],lender_marketplace_agreements:[],banks:[]};}
  rpc(_n:string,_p:any){return Promise.resolve({data:null,error:{message:"rpc_not_deployed"}});}
  from(t:string){return new GQ(this,t);}
}
class GQ {
  db:GS;table:string;filters:Array<{t:string;k:string;v:any}>;_u:Row|null;_i:Row[]|null;_l:number|null;
  constructor(db:GS,t:string){this.db=db;this.table=t;this.filters=[];this._u=null;this._i=null;this._l=null;}
  select(_?:string,_o?:any){return this;} order(_k:string,_o?:any){return this;} limit(n:number){this._l=n;return this;}
  eq(k:string,v:any){this.filters.push({t:"eq",k,v});return this;}
  neq(k:string,v:any){this.filters.push({t:"neq",k,v});return this;}
  in(k:string,v:any[]){this.filters.push({t:"in",k,v});return this;}
  is(k:string,v:any){this.filters.push({t:"is",k,v});return this;}
  gte(_k:string,_v:any){return this;}
  insert(p:Row|Row[]){const rows=Array.isArray(p)?p:[p];const wi=rows.map(r=>({id:r.id??`a-${Math.random().toString(36).slice(2,8)}`,...r}));this.db.tables[this.table]??=[];this.db.tables[this.table].push(...wi);this._i=wi;return this;}
  upsert(p:Row|Row[],_o?:any){return this.insert(p);}
  update(u:Row){this._u=u;return this;}
  delete(){this._u={__del:true};return this;}
  single():Promise<{data:any;error:any}>{if(this._i)return Promise.resolve({data:this._i[0]??null,error:null});return Promise.resolve({data:this.rows()[0]??null,error:null});}
  maybeSingle():Promise<{data:any;error:any}>{if(this._u){if((this._u as any).__del){const r=this.rows();for(const row of r){const i=this.db.tables[this.table].indexOf(row);if(i>=0)this.db.tables[this.table].splice(i,1);}return Promise.resolve({data:r,error:null});}for(const r of this.rows())Object.assign(r,this._u);return Promise.resolve({data:this.rows()[0],error:null});}return Promise.resolve({data:this.rows()[0]??null,error:null});}
  then(f:any,r?:any){if(this._u){if((this._u as any).__del){const rows=this.rows();for(const row of rows){const i=this.db.tables[this.table].indexOf(row);if(i>=0)this.db.tables[this.table].splice(i,1);}return Promise.resolve({data:rows,error:null}).then(f,r);}for(const row of this.rows())Object.assign(row,this._u);return Promise.resolve({data:this.rows(),error:null}).then(f,r);}if(this._i)return Promise.resolve({data:this._i,error:null}).then(f,r);return Promise.resolve({data:this.rows(),error:null}).then(f,r);}
  private rows(){let rows=[...(this.db.tables[this.table]??[])];for(const f of this.filters){if(f.t==="eq")rows=rows.filter(r=>r[f.k]===f.v);else if(f.t==="neq")rows=rows.filter(r=>r[f.k]!==f.v);else if(f.t==="in")rows=rows.filter(r=>(f.v as any[]).includes(r[f.k]));else if(f.t==="is")rows=rows.filter(r=>{const v=r[f.k];return f.v===null?v===null||v===undefined:v===f.v;});}if(this._l!=null)rows=rows.slice(0,this._l);return rows;}
}
test("full run completes",async()=>{const db=new GS();const r=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1"});assert.equal(r.ok,true,`Failed at ${r.failedStage}: ${r.failedReason}`);assert.ok(r.dealId);assert.ok(r.listingId);assert.ok(r.claimId);assert.ok(r.pickId);assert.ok(r.accessId);assert.equal(r.score,78);assert.equal(r.band,"strong_fit");assert.equal(r.lenderName,"Golden Test Bank");assert.equal(db.tables.deals.length,1);assert.equal(db.tables.marketplace_package_access.length,1);});
test("cleanup safe",async()=>{const db=new GS();const r1=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1",cleanup:true});assert.equal(r1.ok,true);assert.equal(db.tables.deals.length,0);const r2=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1",cleanup:true});assert.equal(r2.ok,true);});
test("failed score aborts",async()=>{const db=new GS();const origInsert=GQ.prototype.insert;GQ.prototype.insert=function(p:any){if(this.table==="buddy_sba_scores"){this._i=null;return{...this,single:()=>Promise.resolve({data:null,error:{message:"score_fail"}}),then:(f:any)=>Promise.resolve({data:null,error:{message:"score_fail"}}).then(f)};}return origInsert.call(this,p);};const r=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1"});GQ.prototype.insert=origInsert;assert.equal(r.ok,false);assert.equal(r.failedStage,"score");});
test("failed claim aborts",async()=>{const db=new GS();const origInsert=GQ.prototype.insert;GQ.prototype.insert=function(p:any){if(this.table==="marketplace_claims"){this._i=null;return{...this,single:()=>Promise.resolve({data:null,error:{message:"claim_fail"}}),then:(f:any)=>Promise.resolve({data:null,error:{message:"claim_fail"}}).then(f)};}return origInsert.call(this,p);};const r=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1"});GQ.prototype.insert=origInsert;assert.equal(r.ok,false);assert.equal(r.failedStage,"claim");});
test("failed unlock aborts",async()=>{const db=new GS();const origInsert=GQ.prototype.insert;GQ.prototype.insert=function(p:any){if(this.table==="marketplace_package_access"){this._i=null;return{...this,single:()=>Promise.resolve({data:null,error:{message:"access_fail"}}),then:(f:any)=>Promise.resolve({data:null,error:{message:"access_fail"}}).then(f)};}return origInsert.call(this,p);};const r=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1"});GQ.prototype.insert=origInsert;assert.equal(r.ok,false);assert.equal(r.failedStage,"unlock");});
test("ops validation checks access count",async()=>{const db=new GS();const r=await runGoldenBrokerageRun({sb:db as any,brokerageBankId:"brk-1"});assert.equal(r.ok,true);assert.equal(db.tables.marketplace_package_access.length,1);});
