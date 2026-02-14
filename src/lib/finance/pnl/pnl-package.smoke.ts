import type { PnlPackage } from "./pnl-package.contract";
import buildPnlPackageFromC4 from "@/lib/finance/normalize/normalizePnlFromC4";

const stub: any = {};
const pkg = buildPnlPackageFromC4(stub) satisfies PnlPackage;

void pkg.meta.schema_version;
void pkg.periods;
