import { requireRole } from "@/lib/auth/requireRole";
import BorrowerConditionsCard from "@/components/deals/BorrowerConditionsCard";

export default async function BorrowerHome() {
  await requireRole(["borrower", "super_admin"]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-xl font-semibold">Your Loan Checklist</div>
        <div className="text-sm text-muted-foreground">
          Upload what's missing. Buddy updates your checklist automatically.
        </div>
      </div>

      <BorrowerConditionsCard />
    </div>
  );
}
