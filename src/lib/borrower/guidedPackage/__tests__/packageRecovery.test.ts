import test from "node:test";
import assert from "node:assert/strict";
import { borrowerBudgetReview } from "../budgetReview";
import { packageRecoveryItems } from "../packageRecovery";
import { borrowerPackageFailure } from "../completion";
import { assembleResearchSubject, borrowerResearchInterview } from "@/lib/research/buildResearchSubject";
import { generateRunKey } from "@/lib/research/orchestration";

const loan = { loanAmount:950000,equityInjectionAmount:250000,sellerFinancingAmount:0,otherSources:[] };
test("budget uses the canonical funding calculation and preserves saved inputs", () => {
  const costs = [{category:"equipment",amount:950000}];
  const before = JSON.stringify({loan,costs});
  const review = borrowerBudgetReview(loan,costs)!;
  assert.equal(review.balanced,false); assert.equal(review.difference,250000);
  assert.match(review.message,/\$250,000/);
  assert.equal(JSON.stringify({loan,costs}),before);
  assert.equal(borrowerBudgetReview(loan,[...costs,{category:"working_capital",amount:250000}])?.balanced,true);
  assert.match(borrowerBudgetReview(loan,[{category:"equipment",amount:1500000}])!.message,/costs exceed funding/);
  assert.equal(borrowerBudgetReview({...loan,equityInjectionAmount:null},costs),null);
  assert.equal(borrowerBudgetReview(loan,[{category:"equipment",amount:NaN}]),null);
});
test("release findings give safe specific recovery steps without exposing private error text", () => {
  const error="private-secret Golden Trident release blocked: feasibility_data_completeness_below_70_percent financial_viability.cashRunway location_suitability.accessAndVisibility market_demand.populationAdequacy sources_and_uses_not_reconciled";
  const items=packageRecoveryItems(error);
  assert.deepEqual(items.map(x=>x.id),["budget","feasibility","location","site","cash"]);
  assert.equal(items[0].questionId,"loan.use_of_proceeds");
  assert.doesNotMatch(JSON.stringify(items),/private-secret/);
  assert.match(packageRecoveryItems(error,true)[1].label,/intentionally skipped/);
  assert.match(borrowerPackageFailure(error),/Package checks/);
  assert.deepEqual(packageRecoveryItems("private-secret unknown crash"),[]);
});
test("saved city and site corrections change research identity without certifying borrower claims", () => {
  const raw={borrowerId:"borrower",dealBorrowerName:"Coffee Company",dealCity:"Flowery Branch",dealState:"GA",
    borrowerInterview:borrowerResearchInterview({package_answers:{B05:{value:"Coffee sales"},K01:{value:"7 Brew in Flowery Branch"},J07:{value:"Site access under review"}}})};
  const first=assembleResearchSubject(raw).subject;
  const next=assembleResearchSubject({...raw,dealCity:"Gainesville"}).subject;
  assert.equal(first.city,"Flowery Branch"); assert.match(first.business_description!,/unverified/);
  const key=(subject:typeof first)=>generateRunKey({deal_id:"deal",mission_type:"industry_landscape",depth:"committee",subject});
  assert.notEqual(key(first),key(next));
  const changed=assembleResearchSubject({...raw,borrowerInterview:{...raw.borrowerInterview,siteContext:"Revised site access report"}}).subject;
  assert.notEqual(key(first),key(changed));
});

test("incomplete narratives explain recovery without exposing internal failure details", () => {
  const items = packageRecoveryItems("FatalError: Feasibility narrative acceptance failed: private-storage-path");
  assert.equal(items[0].id, "narrative");
  assert.match(items[0].label, /do not need to re-enter/);
  assert.doesNotMatch(JSON.stringify(items), /private-storage|FatalError/);
});

test("budget recovery never tells the borrower to retry immediately or exposes raw accounting", () => {
  const message = borrowerPackageFailure("private-secret budget_unavailable: verifier QA daily allowance 250000");
  assert.match(message, /wait for capacity/);
  assert.doesNotMatch(message, /private-secret|250000|Retry once/);
});
