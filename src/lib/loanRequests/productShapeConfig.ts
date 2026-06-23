import type { ProductCategory, ProductType } from "./types";

export type FieldVisibility = "show" | "hide" | "optional";

export interface ProductShapeConfig {
  // Structure fields
  showTerm: FieldVisibility;
  showAmort: FieldVisibility;
  showEvergreen: boolean;
  showInterestOnly: boolean;
  // Rate fields
  showRateIndex: boolean;
  showSpread: boolean;
  showRatePreference: boolean;
  // Product-specific sections
  showRealEstate: boolean;
  showLtv: boolean;
  showSba: boolean;
  showEquipmentDetails: boolean;
  showLineDetails: boolean;
}

const LOC_SHAPE: ProductShapeConfig = {
  showTerm: "hide",
  showAmort: "hide",
  showEvergreen: true,
  showInterestOnly: false,
  showRateIndex: true,
  showSpread: true,
  showRatePreference: true,
  showRealEstate: false,
  showLtv: false,
  showSba: false,
  showEquipmentDetails: false,
  showLineDetails: true,
};

const TERM_LOAN_SHAPE: ProductShapeConfig = {
  showTerm: "show",
  showAmort: "show",
  showEvergreen: false,
  showInterestOnly: true,
  showRateIndex: true,
  showSpread: true,
  showRatePreference: true,
  showRealEstate: false,
  showLtv: false,
  showSba: false,
  showEquipmentDetails: false,
  showLineDetails: false,
};

const REAL_ESTATE_SHAPE: ProductShapeConfig = {
  showTerm: "show",
  showAmort: "show",
  showEvergreen: false,
  showInterestOnly: true,
  showRateIndex: true,
  showSpread: true,
  showRatePreference: true,
  showRealEstate: true,
  showLtv: true,
  showSba: false,
  showEquipmentDetails: false,
  showLineDetails: false,
};

const SBA_SHAPE: ProductShapeConfig = {
  showTerm: "show",
  showAmort: "show",
  showEvergreen: false,
  showInterestOnly: false,
  showRateIndex: true,
  showSpread: false,
  showRatePreference: true,
  showRealEstate: false,
  showLtv: false,
  showSba: true,
  showEquipmentDetails: false,
  showLineDetails: false,
};

const DEFAULT_SHAPE: ProductShapeConfig = {
  showTerm: "optional",
  showAmort: "optional",
  showEvergreen: false,
  showInterestOnly: false,
  showRateIndex: true,
  showSpread: true,
  showRatePreference: true,
  showRealEstate: false,
  showLtv: false,
  showSba: false,
  showEquipmentDetails: false,
  showLineDetails: false,
};

export const PRODUCT_SHAPE_BY_CATEGORY: Record<ProductCategory, ProductShapeConfig> = {
  LINES_OF_CREDIT: LOC_SHAPE,
  TERM_LOANS: TERM_LOAN_SHAPE,
  REAL_ESTATE: REAL_ESTATE_SHAPE,
  SBA: SBA_SHAPE,
  SPECIALTY: DEFAULT_SHAPE,
};

export const PRODUCT_SHAPE_OVERRIDES: Partial<Record<string, Partial<ProductShapeConfig>>> = {
  EQUIPMENT: { showEquipmentDetails: true },
  VEHICLE: { showEquipmentDetails: true },
  ACCOUNTS_RECEIVABLE: { showLineDetails: true, showTerm: "hide", showAmort: "hide", showEvergreen: true },
  INVENTORY: { showLineDetails: true, showTerm: "hide", showAmort: "hide" },
};

export function getProductShape(
  category: ProductCategory | undefined,
  productCode: string | undefined,
): ProductShapeConfig {
  const base = category ? PRODUCT_SHAPE_BY_CATEGORY[category] : DEFAULT_SHAPE;
  const override = productCode ? PRODUCT_SHAPE_OVERRIDES[productCode] : undefined;
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Map a ProductType code to its ProductCategory.
 * Single source of truth for product classification.
 */
export function productTypeToCategory(
  productType: ProductType | string | null | undefined,
): ProductCategory {
  if (!productType) return "SPECIALTY";
  switch (productType) {
    case "LOC_SECURED":
    case "LOC_UNSECURED":
    case "LOC_RE_SECURED":
    case "LINE_OF_CREDIT":
      return "LINES_OF_CREDIT";
    case "CRE_PURCHASE":
    case "CRE_REFI":
    case "CRE_CASH_OUT":
    case "CRE_TERM":
    case "CONSTRUCTION":
    case "LAND":
    case "BRIDGE":
      return "REAL_ESTATE";
    case "SBA_7A":
    case "SBA_7A_STANDARD":
    case "SBA_7A_SMALL":
    case "SBA_504":
    case "SBA_EXPRESS":
    case "SBA_CAPLines":
      return "SBA";
    case "TERM_SECURED":
    case "TERM_UNSECURED":
    case "C_AND_I_TERM":
    case "EQUIPMENT":
    case "VEHICLE":
    case "WORKING_CAPITAL":
    case "REFINANCE":
      return "TERM_LOANS";
    default:
      return "SPECIALTY";
  }
}

/**
 * Get the product shape for a ProductType directly.
 */
export function getProductShapeForType(
  productType: ProductType | string | null | undefined,
): ProductShapeConfig {
  const category = productTypeToCategory(productType);
  return getProductShape(category, productType ?? undefined);
}
