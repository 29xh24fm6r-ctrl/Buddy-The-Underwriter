export {
  getQABorrowerEmail,
  isQABorrowerEmail,
  isTestAuthEnabled,
  getTestOtp,
  QA_BORROWER_NAME,
  assertQATestAuthSafety,
  canUseDeterministicOtp,
  validateDeterministicOtp,
} from "./config";

export { generateTestRunId } from "./testRunId";

export {
  markDealAsTestApplication,
  createQATestApplication,
  listQATestApplications,
} from "./markTestApplication";

export {
  sendQAVerificationCode,
  verifyQACode,
} from "./qaAuth";

export type {
  QASendCodeResult,
  QAVerifyCodeResult,
} from "./qaAuth";

export {
  isTestDealFilter,
  isDealTestApplication,
  assertNotTestDeal,
  assertIsTestDeal,
} from "./isolation";

export {
  resolveAuthorizedDealState,
} from "./authorization";

export type {
  DealAuthorizationState,
  AuthorizedDealResult,
} from "./authorization";
