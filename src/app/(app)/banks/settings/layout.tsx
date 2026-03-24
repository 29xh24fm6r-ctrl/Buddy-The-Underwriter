import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export default async function BankSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await tryGetCurrentBankId();

  // Middleware owns auth; page owns bank-state only
  if (!result.ok) {
    if (result.reason === "bank_selection_required") {
      redirect("/select-bank");
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <h1 className="text-xl font-semibold text-white">
          Access Denied
        </h1>
        <p className="mt-2 text-sm text-white/60 max-w-md">
          {result.reason === "no_memberships"
            ? "Your account is not associated with any bank. Please contact an administrator."
            : "You don't have access to bank settings. Please contact an administrator."}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
