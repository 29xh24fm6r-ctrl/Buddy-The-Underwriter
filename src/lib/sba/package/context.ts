export type SbaPackageContext = {
  dealId: string;
  token?: string | null;
  product: "7a" | "504" | "express";
  answers: Record<string, any>;
  borrowerData?: Record<string, any> | null;
  normalized: {
    businessName?: string | null;
    borrowerName?: string | null;
    email?: string | null;
    phone?: string | null;
    loanAmount?: number | null;
    isForProfit?: boolean | null;
    isUsBased?: boolean | null;
    annualRevenue?: number | null;
    numEmployees?: number | null;
    addressLine1?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    addressZip?: string | null;
  };
};

function toBool(v: any): boolean | null {
  if (v === true || v === "true" || v === "TRUE" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === "FALSE" || v === 0 || v === "0") return false;
  return null;
}
function toNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function toStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function buildSbaPackageContext(opts: {
  dealId: string;
  token?: string | null;
  product: "7a" | "504" | "express";
  answers: Record<string, any>;
  borrowerData?: Record<string, any> | null;
}): SbaPackageContext {
  const { dealId, token, product, answers, borrowerData } = opts;

  const businessName =
    toStr(borrowerData?.entityName) ||
    toStr(answers.entity_name ?? answers.business_name ?? answers.company_name);

  const borrowerName =
    toStr(answers.borrower_name ?? answers.owner_name ?? answers.primary_contact_name);

  const email = toStr(answers.email ?? answers.contact_email);
  const phone = toStr(answers.phone ?? answers.contact_phone);

  const loanAmount = toNumber(answers.loan_amount ?? answers.requested_amount);

  const isForProfit = toBool(answers.is_for_profit);
  const isUsBased = toBool(answers.is_us_based);

  const annualRevenue = toNumber(answers.annual_revenue ?? answers.revenue);
  const numEmployees = toNumber(answers.num_employees ?? answers.employees);

  const addressLine1 = toStr(answers.address_line1 ?? answers.business_address_line1);
  const addressCity = toStr(answers.address_city ?? answers.business_address_city);
  const addressState = toStr(answers.address_state ?? answers.business_address_state);
  const addressZip = toStr(answers.address_zip ?? answers.business_address_zip);

  return {
    dealId,
    token: token ?? null,
    product,
    answers,
    borrowerData: borrowerData ?? null,
    normalized: {
      businessName,
      borrowerName,
      email,
      phone,
      loanAmount,
      isForProfit,
      isUsBased,
      annualRevenue,
      numEmployees,
      addressLine1,
      addressCity,
      addressState,
      addressZip,
    },
  };
}
