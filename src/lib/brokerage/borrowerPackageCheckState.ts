import type { PackageRecoveryItem } from "@/lib/borrower/guidedPackage/packageRecovery";

export type PackageCapacity = { available: boolean; message: string | null };
export type BorrowerPackageCheck = {
  checkedAt: string;
  status: "passed" | "blocked" | "not_checked";
  message: string;
  recoveryItems: PackageRecoveryItem[];
};
