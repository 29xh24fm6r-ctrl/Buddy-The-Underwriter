export * from "./types";
export * from "./identityValidator";
export { getForm1065Spec, FORM_1065_SPECS } from "./formSpecs/form1065";
export { getForm1120Spec, getForm1120SSpec } from "./formSpecs/form1120";
export { getScheduleCSpec } from "./formSpecs/scheduleC";

import { getForm1065Spec } from "./formSpecs/form1065";
import { getForm1120Spec, getForm1120SSpec } from "./formSpecs/form1120";
import { getScheduleCSpec } from "./formSpecs/scheduleC";
import type { IrsFormType, FormSpecification } from "./types";

export function getFormSpec(
  formType: IrsFormType,
  taxYear: number,
): FormSpecification | null {
  switch (formType) {
    case "FORM_1065": return getForm1065Spec(taxYear);
    case "FORM_1120": return getForm1120Spec(taxYear);
    case "FORM_1120S": return getForm1120SSpec(taxYear);
    case "SCHEDULE_C": return getScheduleCSpec(taxYear);
    default: return null;
  }
}
