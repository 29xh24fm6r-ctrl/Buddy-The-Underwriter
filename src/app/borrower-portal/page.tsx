import { redirect } from "next/navigation";

export default function BorrowerPortalLanding() {
  // Temporary token until you wire auth/real invite tokens
  redirect("/borrower/portal/demo");
}
