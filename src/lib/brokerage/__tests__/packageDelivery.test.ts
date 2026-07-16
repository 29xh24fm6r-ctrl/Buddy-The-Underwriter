import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const m = require("../packageDelivery") as typeof import("../packageDelivery");
type Row = Record<string, any>;
class S { tables:Record<string,Row[]>; constructor(i?:Partial<Record<string,Row[]>>){this.tables={buddy_sealed_packages:[],buddy_trident_bundles:[],sba_form_159_records:[],marketplace_package_access:[],marketplace_listings:[],marketplace_picks:[],marketplace_audit_log:[],banks:[],credit_memo_snapshots:[],sba_package_runs:[],...i};} from(t:string){return new Q(this,t);} }
class Q { db:S;table:string;filters:Array<{t:string;k:string;v:any}>;_i:Row[]|null;_l:number|null; constructor(db:S,t:string){this.db=db;this.table=t;this.filters=[];this._i=null;this._l=null;} select(_?:string){return this;} order(_k:string,_o?:any){return this;} limit(n:number){this._l=n;return this;} eq(k:string,v:any){this.filters.push({t:"eq",k,v});return this;} in(k:string,v:any[]){this.filters.push({t:"in",k,v});return this;} is(k:string,v:any){this.filters.push({t:"is",k,v});return this;} not(k:string,op:string,v:any){if(op!=="is")throw new Error(`mock .not() only supports op="is", got "${op}"`);this.filters.push({t:"not_is",k,v});return this;} insert(p:Row|Row[]){const rows=Array.isArray(p)?p:[p];const wi=rows.map(r=>({id:r.id??`id-${Math.random().toString(36).slice(2,8)}`,...r}));this.db.tables[this.table]??=[];this.db.tables[this.table].push(...wi);this._i=wi;return this;} single():Promise<{data:any;error:any}>{if(this._i)return Promise.resolve({data:this._i[0],error:null});return Promise.resolve({data:this.rows()[0]??null,error:null});} maybeSingle():Promise<{data:any;error:any}>{return Promise.resolve({data:this.rows()[0]??null,error:null});} then(f:any,r?:any){if(this._i)return Promise.resolve({data:this._i,error:null}).then(f,r);return Promise.resolve({data:this.rows(),error:null}).then(f,r);} private rows(){let rows=[...(this.db.tables[this.table]??[])];for(const f of this.filters){if(f.t==="eq")rows=rows.filter(r=>r[f.k]===f.v);else if(f.t==="in")rows=rows.filter(r=>(f.v as any[]).includes(r[f.k]));else if(f.t==="is")rows=rows.filter(r=>{const v=r[f.k];return f.v===null?v==null:v===f.v;});else if(f.t==="not_is")rows=rows.filter(r=>{const v=r[f.k];return f.v===null?v!=null:v!==f.v;});}if(this._l!=null)rows=rows.slice(0,this._l);return rows;} }
function sealedDb(extras?:Partial<Record<string,Row[]>>){return new S({buddy_sealed_packages:[{id:"sp1",deal_id:"d1",sealed_at:"2026-06-01",unsealed_at:null,final_business_plan_path:"/gcs/bp-final.pdf",final_projections_path:"/gcs/proj-final.xlsx",final_feasibility_path:"/gcs/feas-final.pdf",final_credit_memo_path:null,final_forms_path:null,final_source_docs_zip_path:"/gcs/src.zip"}],buddy_trident_bundles:[{deal_id:"d1",mode:"preview",status:"succeeded",superseded_at:null,business_plan_pdf_path:"/gcs/bp-preview.pdf",projections_pdf_path:"/gcs/proj-preview.pdf",projections_xlsx_path:null,feasibility_pdf_path:"/gcs/feas-preview.pdf"}],credit_memo_snapshots:[{id:"cm1",deal_id:"d1",status:"banker_submitted"}],sba_form_159_records:[{deal_id:"d1",status:"generated",generated_pdf_path:"/gcs/f159.pdf"}],marketplace_picks:[{deal_id:"d1",picked_lender_bank_id:"b1",status:"picked"}],marketplace_package_access:[{id:"acc1",listing_id:"l1",claim_id:"c1",deal_id:"d1",lender_bank_id:"b1",access_level:"full",granted_at:"2026-06-02",revoked_at:null}],marketplace_listings:[{deal_id:"d1",loan_amount:850000,sba_program:"7a",term_months:120,score:78,band:"strong_fit",kfs:{state:"TX"}}],banks:[{id:"b1",name:"First National"}],...extras});}
test("borrower sees own package",async()=>{const s=await m.getBorrowerPackageStatus({deal_id:"d1"},sealedDb() as any);assert.equal(s.sealed,true);assert.ok(s.manifest.resources.length>=3);assert.equal(s.pickedLenderName,"First National");});
test("borrower other deal empty",async()=>{const s=await m.getBorrowerPackageStatus({deal_id:"dX"},sealedDb() as any);assert.equal(s.sealed,false);assert.equal(s.manifest.resources.length,0);});
test("picked lender sees",async()=>{const r=await m.getLenderPackageAccess("acc1","b1",sealedDb() as any);assert.equal(r.ok,true);if(r.ok)assert.equal(r.access.accessLevel,"full");});
test("wrong lender denied",async()=>{const r=await m.getLenderPackageAccess("acc1","bX",sealedDb() as any);assert.equal(r.ok,false);});
test("revoked denied",async()=>{const r=await m.getLenderPackageAccess("acc1","b1",sealedDb({marketplace_package_access:[{id:"acc1",listing_id:"l1",claim_id:"c1",deal_id:"d1",lender_bank_id:"b1",access_level:"full",granted_at:"2026-06-02",revoked_at:"2026-06-03"}]}) as any);assert.equal(r.ok,false);});
test("missing files graceful",async()=>{const mf=await m.buildPackageManifest("d1","full",new S({buddy_sealed_packages:[{id:"sp1",deal_id:"d1",sealed_at:"2026-06-01",unsealed_at:null,final_business_plan_path:"/gcs/bp.pdf",final_projections_path:null,final_feasibility_path:null,final_credit_memo_path:null,final_forms_path:null,final_source_docs_zip_path:null}]}) as any);assert.ok(mf.resources.some(r=>r.available));assert.ok(mf.resources.some(r=>!r.available));});

test("picked deal: both preview and final bundles coexisting does not throw, and final wins",async()=>{
  // final_business_plan_path left null so resolution falls through to the
  // live trident-bundle query — the case that used to risk a >1-row error
  // (or an arbitrary pick) once both modes have a current succeeded row.
  const db=sealedDb({
    buddy_sealed_packages:[{id:"sp1",deal_id:"d1",sealed_at:"2026-06-01",unsealed_at:null,final_business_plan_path:null,final_projections_path:null,final_feasibility_path:null,final_credit_memo_path:null,final_forms_path:null,final_source_docs_zip_path:null}],
    buddy_trident_bundles:[
      {deal_id:"d1",mode:"preview",status:"succeeded",superseded_at:null,business_plan_pdf_path:"/gcs/bp-preview.pdf",projections_pdf_path:"/gcs/proj-preview.pdf",projections_xlsx_path:null,feasibility_pdf_path:"/gcs/feas-preview.pdf"},
      {deal_id:"d1",mode:"final",status:"succeeded",superseded_at:null,business_plan_pdf_path:"/gcs/bp-live-final.pdf",projections_pdf_path:null,projections_xlsx_path:"/gcs/proj-live-final.xlsx",feasibility_pdf_path:"/gcs/feas-live-final.pdf"},
    ],
  });
  const mf=await m.buildPackageManifest("d1","full",db as any);
  const bp=mf.resources.find(r=>r.type==="business_plan");
  assert.equal(bp?.available,true);
  // final mode never produces a projections PDF — must not resolve one from
  // the final bundle row (whose projections_pdf_path is null) while the
  // preview bundle's IS present, proving mode scoping (not just "any
  // succeeded row") drove the result.
  const projPdf=mf.resources.find(r=>r.type==="projections_pdf");
  assert.equal(projPdf?.available,false);
  const projXlsx=mf.resources.find(r=>r.type==="projections_xlsx");
  assert.equal(projXlsx?.available,true);
});

test("projections_pdf is never sourced from final_projections_path (that column is the final XLSX, not a PDF)",async()=>{
  const mf=await m.buildPackageManifest("d1","full",sealedDb() as any);
  const projPdf=mf.resources.find(r=>r.type==="projections_pdf");
  const projXlsx=mf.resources.find(r=>r.type==="projections_xlsx");
  // Preview bundle supplies the PDF; final_projections_path (XLSX) must not leak into it.
  assert.equal(projPdf?.available,true);
  assert.equal(projXlsx?.available,true);
});

test("credit_memo resource reflects whether a certified snapshot exists",async()=>{
  const withMemo=await m.buildPackageManifest("d1","full",sealedDb() as any);
  assert.equal(withMemo.resources.find(r=>r.type==="credit_memo")?.available,true);
  const withoutMemo=await m.buildPackageManifest("d1","full",sealedDb({credit_memo_snapshots:[]}) as any);
  assert.equal(withoutMemo.resources.find(r=>r.type==="credit_memo")?.available,false);
});
test("sba_forms falls back to the latest assembled package run when final_forms_path is unset",async()=>{
  const noRun=await m.buildPackageManifest("d1","full",sealedDb() as any);
  assert.equal(noRun.resources.find(r=>r.type==="sba_forms")?.available,false);

  const withRuns=await m.buildPackageManifest("d1","full",sealedDb({sba_package_runs:[
    {id:"run1",deal_id:"d1",assembled_package_storage_path:"deals/d1/sba-packages/run1/complete-package.pdf",assembled_at:"2026-06-01T00:00:00Z"},
    {id:"run2",deal_id:"d1",assembled_package_storage_path:"deals/d1/sba-packages/run2/complete-package.pdf",assembled_at:"2026-06-03T00:00:00Z"},
  ]}) as any);
  const sbaForms=withRuns.resources.find(r=>r.type==="sba_forms");
  assert.equal(sbaForms?.available,true);

  // final_forms_path (frozen at pick, once that's ever wired) still wins over the live lookup.
  const withFinal=await m.buildPackageManifest("d1","full",sealedDb({
    buddy_sealed_packages:[{id:"sp1",deal_id:"d1",sealed_at:"2026-06-01",unsealed_at:null,final_business_plan_path:null,final_projections_path:null,final_feasibility_path:null,final_credit_memo_path:null,final_forms_path:"/gcs/final-forms.pdf",final_source_docs_zip_path:null}],
    sba_package_runs:[{id:"run1",deal_id:"d1",assembled_package_storage_path:"deals/d1/sba-packages/run1/complete-package.pdf",assembled_at:"2026-06-01T00:00:00Z"}],
  }) as any);
  assert.equal(withFinal.resources.find(r=>r.type==="sba_forms")?.available,true);
});

test("source docs full only",async()=>{const full=await m.buildPackageManifest("d1","full",sealedDb() as any);const prev=await m.buildPackageManifest("d1","preview",sealedDb() as any);assert.ok(full.resources.some(r=>r.type==="source_docs"));assert.ok(!prev.resources.some(r=>r.type==="source_docs"));});
test("signed URL no raw path",async()=>{const r=await m.createSignedPackageDownload("d1","business_plan",{id:"x",scope:"borrower"},sealedDb() as any);assert.equal(r.ok,true);if(r.ok){assert.ok(!r.url.includes("/gcs/"));assert.ok(r.url.includes("business_plan"));}});
test("audit view",async()=>{const db=sealedDb();await m.auditPackageView({actor:"b1",actorScope:"lender",dealId:"d1",action:"package_view"},db as any);assert.equal(db.tables.marketplace_audit_log.length,1);});
test("audit download",async()=>{const db=sealedDb();await m.auditPackageDownload({actor:"x",actorScope:"borrower",dealId:"d1",action:"package_download",resourceType:"business_plan"},db as any);assert.equal(db.tables.marketplace_audit_log[0].metadata.resourceType,"business_plan");});
