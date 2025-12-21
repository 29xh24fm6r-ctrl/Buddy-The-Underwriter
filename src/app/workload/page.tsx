// src/app/workload/page.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getCurrentRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WorkloadPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const pick = await tryGetCurrentBankId();
  if (!pick.ok) redirect("/deals");

  let role = null;
  try {
    const r = await getCurrentRole();
    role = r.role;
  } catch {}

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold">My Workload</h1>
      <p className="text-muted-foreground mt-2">
        View deals assigned to you.
      </p>

      <div className="mt-6 rounded-2xl border p-6">
        <div className="text-sm text-muted-foreground">
          Workload dashboard coming soon. Will show:
          <ul className="list-disc ml-6 mt-2">
            <li>Deals assigned to {user.firstName ?? "you"}</li>
            <li>Tasks requiring your attention</li>
            <li>Pipeline status and metrics</li>
            <li>Recent activity on your deals</li>
          </ul>
          <div className="mt-4">
            Current role: <span className="font-semibold">{role ? role.replace(/_/g, " ") : "none"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
