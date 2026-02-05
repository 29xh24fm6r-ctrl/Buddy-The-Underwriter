import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export default async function BankSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await tryGetCurrentBankId();

  if (!result.ok) {
    if (result.reason === "not_authenticated") {
      redirect("/sign-in");
    }

    // bank_selection_required, no_memberships, etc.
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <h1 className="text-xl font-semibold text-white">
          Access Denied
        </h1>
        <p className="mt-2 text-sm text-white/60 max-w-md">
          {result.reason === "no_memberships"
            ? "Your account is not associated with any bank. Please contact an administrator."
            : result.reason === "bank_selection_required"
              ? "Please select a bank before accessing settings."
              : "You don't have access to bank settings. Please contact an administrator."}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
