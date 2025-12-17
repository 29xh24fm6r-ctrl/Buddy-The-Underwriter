import type { MoodyPnlPackage } from "./moody-package.contract";
import buildMoodyPnlPackageFromC4 from "@/lib/finance/normalize/normalizePnlFromC4";

const stub: any = {};
const pkg = buildMoodyPnlPackageFromC4(stub) satisfies MoodyPnlPackage;

void pkg.meta.schema_version;
void pkg.periods;
