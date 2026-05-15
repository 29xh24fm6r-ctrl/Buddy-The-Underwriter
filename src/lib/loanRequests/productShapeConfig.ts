import type { ProductCategory } from "./types";

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
