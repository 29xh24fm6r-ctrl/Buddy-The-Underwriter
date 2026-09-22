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
