import type { JWTPayload } from "jose";

const REPOSITORY = "29xh24fm6r-ctrl/Buddy-The-Underwriter";
const WORKFLOW =
  `${REPOSITORY}/.github/workflows/brokerage-production-certification.yml@refs/heads/main`;
const SUBJECT = `repo:${REPOSITORY}:environment:Production`;

export function hasValidBrokerageCertificationClaims(
  claims: JWTPayload,
): boolean {
  return (
    claims.repository === REPOSITORY &&
    claims.repository_id === "1117619648" &&
    claims.repository_owner_id === "243685602" &&
    claims.ref === "refs/heads/main" &&
    claims.event_name === "workflow_dispatch" &&
    claims.environment === "Production" &&
    claims.workflow_ref === WORKFLOW &&
    claims.sub === SUBJECT
  );
}
