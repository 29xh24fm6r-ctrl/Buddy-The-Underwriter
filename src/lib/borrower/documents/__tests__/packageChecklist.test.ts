import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { evaluatePackageDocuments, readPackageDocumentReadiness } = require("../packageChecklist") as typeof import("../packageChecklist");
const request = {checklist_key:"IRS_PERSONAL_3Y", title:"Personal returns",required:true,status:"received",required_years:[2023,2024,2025]};
const document = {id:"doc",canonical_type:"PERSONAL_TAX_RETURN",document_type:"PERSONAL_TAX_RETURN",logical_key:"PERSONAL_TAX_RETURN|2025|owner-1",is_active:true,quality_status:"PASSED",intake_status:"USER_CONFIRMED",storage_path:"private/return.pdf",doc_years:[2023,2024,2025]};
test("received checklist status without real documents does not pass",()=>assert.equal(evaluatePackageDocuments([request],[],{},[]).ok,false));
test("all requested tax years with confirmed evidence pass",()=>assert.equal(evaluatePackageDocuments([request],[document],{},[]).ok,true));
test("entity-scoped evidence without a verified owner binding does not pass",()=>assert.equal(evaluatePackageDocuments([request],[{...document,logical_key:null}],{},[]).ok,false));
test("missing and duplicate tax years cannot complete the request",()=>{
 const r=evaluatePackageDocuments([request],[{...document,doc_years:[2023,2023,2024]}],{},[]);
 assert.equal(r.ok,false);assert.match(r.reasons[0],/2025/);
});
for(const patch of [{is_active:false},{quality_status:"FAILED_LOW_CONFIDENCE"},{intake_status:"CLASSIFIED_PENDING_REVIEW"},{storage_path:null}]) test(`unusable upload blocks ${JSON.stringify(patch)}`,()=>assert.equal(evaluatePackageDocuments([request],[{...document,...patch}],{},[]).ok,false));
test("empty checklist fails closed",()=>assert.equal(evaluatePackageDocuments([],[],{},[]).ok,false));
test("unknown requested years do not pass from arbitrary old returns",()=>assert.equal(evaluatePackageDocuments([{...request,required_years:null}],[document],{},[]).ok,false));
test("startup exemption requires explicit saved pre-opening context and never exempts personal returns",()=>{
 const facts={package_answers:{B07:{value:"The business is preparing to open"}}};
 const requests=[{...request,checklist_key:"IRS_BUSINESS_3Y"},{...request,checklist_key:"FIN_STMT_PL_YTD"}];
 assert.equal(evaluatePackageDocuments(requests,[],facts,[]).ok,true);
 assert.equal(evaluatePackageDocuments(requests,[],{},[]).ok,false);
 assert.equal(evaluatePackageDocuments([request],[],facts,[]).ok,false);
});
test("generated forms avoid duplicate uploads but unfinished owner forms do not pass",()=>{
 const item={...request,checklist_key:"PFS_CURRENT",required_years:null};
 const form={template_code:"SBA_413",status:"generated",output_storage_path:"pfs.pdf"};
 assert.equal(evaluatePackageDocuments([item],[],{},[form]).ok,true);
 assert.equal(evaluatePackageDocuments([item],[],{},[form,{...form,status:"prepared"}]).ok,false);
 assert.equal(evaluatePackageDocuments([item],[],{},[],"prepare").ok,true);
 assert.equal(evaluatePackageDocuments([item],[],{},[],"submit").ok,false);
});
test("waived and optional requests retain existing applicability",()=>{
 assert.equal(evaluatePackageDocuments([{...request,status:"waived"}],[],{},[]).ok,true);
 assert.equal(evaluatePackageDocuments([request,{...request,checklist_key:"OTHER",required:false}],[document],{},[]).ok,true);
});
test("database failure returns a blocker rather than an empty successful checklist",async()=>{
 const sb={from(){throw Error("database offline");}};
 const result=await readPackageDocumentReadiness("deal",sb);
 assert.equal(result.ok,false);assert.match(result.reasons[0],/could not be verified/);
});

const franchiseItems = [
 {code:"FRANCHISE_DISCLOSURE_DOCUMENT",title:"Franchise Disclosure Document",required:true},
 {code:"FRANCHISE_AGREEMENT",title:"Franchise Agreement",required:true},
 {code:"SBA_FRANCHISE_ADDENDUM",title:"SBA Franchise Addendum",required:true},
];
test("franchise requests appear during preparation and prevent sealing until their actual files are confirmed",()=>{
 const prepare=evaluatePackageDocuments([{...request,checklist_key:"FIN_STMT_BS_YTD",required_years:null}],
  [{...document,checklist_key:"FIN_STMT_BS_YTD"}],{},[],"prepare",franchiseItems);
 assert.equal(prepare.ok,true);
 assert.equal(prepare.items.filter(item=>item.state==="missing").length,3);
 const submit=evaluatePackageDocuments([{...request,checklist_key:"FIN_STMT_BS_YTD",required_years:null}],
  [{...document,checklist_key:"FIN_STMT_BS_YTD"}],{},[],"submit",franchiseItems);
 assert.equal(submit.ok,false);assert.equal(submit.reasons.length,3);
 const franchiseDocs=franchiseItems.map(({code})=>({...document,checklist_key:code}));
 assert.equal(evaluatePackageDocuments([{...request,checklist_key:"FIN_STMT_BS_YTD",required_years:null}],
  [{...document,checklist_key:"FIN_STMT_BS_YTD"},...franchiseDocs],{},[],"submit",franchiseItems).ok,true);
 for(const patch of [{is_active:false},{storage_path:null},{intake_status:"PENDING",finalized_at:null},{quality_status:"REJECTED"}]) {
  const docs=franchiseDocs.map((d,i)=>i===0?{...d,...patch}:d);
  assert.equal(evaluatePackageDocuments([{...request,checklist_key:"FIN_STMT_BS_YTD",required_years:null}],
   [{...document,checklist_key:"FIN_STMT_BS_YTD"},...docs],{},[],"submit",franchiseItems).ok,false);
 }
});

test("linked franchise with incomplete seeding fails closed; unlinked deal ignores stale portal requests",async()=>{
 const rows:Record<string,any>={deal_checklist_items:[{...request,checklist_key:"FIN_STMT_BS_YTD",required_years:null}],
  deal_documents:[{...document,checklist_key:"FIN_STMT_BS_YTD"}],borrower_concierge_sessions:{confirmed_facts:{}},
  sba_package_runs:null,deal_franchises:{brand_id:"brand"},deal_portal_checklist_items:franchiseItems.slice(0,2)};
 const sb={from(table:string){const q:any={select(){return q},eq(){return q},order(){return q},limit(){return q},
  maybeSingle(){return Promise.resolve({data:rows[table],error:null})},
  then(resolve:any,reject:any){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject)}};return q}};
 const incomplete=await readPackageDocumentReadiness("deal",sb,"submit");
 assert.equal(incomplete.ok,false);assert.match(incomplete.reasons.join(" "),/requests could not be verified/);
 rows.deal_franchises=null;
 const unlinked=await readPackageDocumentReadiness("deal",sb,"submit");
 assert.equal(unlinked.ok,true);assert.equal(unlinked.items.length,1);
});

test("a waived canonical row cannot waive the same franchise evidence request",()=>{
 const canonical=[{...request,checklist_key:"FRANCHISE_AGREEMENT",status:"waived",required_years:null}];
 const franchise=[{code:"FRANCHISE_AGREEMENT",title:"Signed franchise agreement",required:true}];
 const missing=evaluatePackageDocuments(canonical,[],{},[],"submit",franchise);
 assert.equal(missing.ok,false);
 assert.match(missing.reasons.join(" "),/Signed franchise agreement/);
 const confirmed=evaluatePackageDocuments(canonical,[{...document,checklist_key:"FRANCHISE_AGREEMENT"}],{},[],"submit",franchise);
 assert.equal(confirmed.ok,true);
});
