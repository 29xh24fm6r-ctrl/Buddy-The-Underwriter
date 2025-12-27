/**
 * E-Tran XML Generator
 * 
 * Generates SBA E-Tran XML from Deal Truth Snapshot
 * 
 * CRITICAL: This NEVER auto-submits. Human approval required.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { XMLBuilder } from "fast-xml-parser";

export interface ETranData {
  // SBA Lender Info
  lender_id: string;
  service_center: string;
  
  // Borrower Info
  business_legal_name: string;
  business_dba: string;
  business_ein: string;
  business_address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  
  // Loan Details
  loan_amount: number;
  term_months: number;
  interest_rate: number;
  sba_guarantee_percentage: number;
  
  // Eligibility
  naics_code: string;
  business_type: string; // Corporation, LLC, etc.
  number_of_employees: number;
  
  // Owners (>=20%)
  owners: Array<{
    name: string;
    ssn: string;
    ownership_percentage: number;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  }>;
  
  // Use of Proceeds
  use_of_proceeds: Array<{
    category: string;
    amount: number;
  }>;
  
  // Financials
  revenue_trailing_12: number;
  ebitda: number;
  debt_service_coverage_ratio: number;
  
  // Collateral
  collateral_items: Array<{
    type: string;
    description: string;
    value: number;
  }>;
}

/**
 * Generate E-Tran XML from deal truth snapshot
 */
export async function generateETranXML(params: {
  dealId: string;
  bankId: string;
  truthSnapshotId?: string;
}): Promise<{
  xml: string;
  validation_errors: string[];
  ready_for_review: boolean;
}> {
  const sb = supabaseAdmin();
  
  // Get latest truth snapshot if not specified
  let snapshotId = params.truthSnapshotId;
  if (!snapshotId) {
    const { data: snapshot } = await sb
      .from("deal_truth_snapshots")
      .select("id")
      .eq("deal_id", params.dealId)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    
    snapshotId = snapshot?.id;
  }
  
  if (!snapshotId) {
    return {
      xml: "",
      validation_errors: ["No truth snapshot found"],
      ready_for_review: false,
    };
  }
  
  // Get truth snapshot
  const { data: truth, error: truthErr } = await sb
    .from("deal_truth_snapshots")
    .select("truth")
    .eq("id", snapshotId)
    .single();
  
  if (truthErr || !truth) {
    return {
      xml: "",
      validation_errors: ["Failed to load truth snapshot"],
      ready_for_review: false,
    };
  }
  
  // Get bank settings for SBA lender ID
  const { data: bank } = await sb
    .from("banks")
    .select("settings")
    .eq("id", params.bankId)
    .single();
  
  const lenderId = bank?.settings?.sba_lender_id || process.env.SBA_LENDER_ID || "";
  const serviceCenter = bank?.settings?.sba_service_center || process.env.SBA_SERVICE_CENTER || "";
  
  // Map truth snapshot to E-Tran data
  const etranData = mapTruthToETran(truth.truth, lenderId, serviceCenter);
  
  // Validate data
  const validationErrors = validateETranData(etranData);
  
  // Generate XML
  const xml = buildETranXML(etranData);
  
  return {
    xml,
    validation_errors: validationErrors,
    ready_for_review: validationErrors.length === 0,
  };
}

/**
 * Map deal truth to E-Tran format
 */
function mapTruthToETran(truth: any, lenderId: string, serviceCenter: string): ETranData {
  return {
    lender_id: lenderId,
    service_center: serviceCenter,
    
    business_legal_name: truth.business?.legal_name || "",
    business_dba: truth.business?.dba || "",
    business_ein: truth.business?.ein || "",
    business_address: {
      street: truth.business?.address?.street || "",
      city: truth.business?.address?.city || "",
      state: truth.business?.address?.state || "",
      zip: truth.business?.address?.zip || "",
    },
    
    loan_amount: truth.loan?.amount || 0,
    term_months: truth.loan?.term_months || 120,
    interest_rate: truth.loan?.interest_rate || 0,
    sba_guarantee_percentage: 75, // Standard 7(a) guarantee
    
    naics_code: truth.business?.naics_code || "",
    business_type: truth.business?.entity_type || "",
    number_of_employees: truth.business?.number_of_employees || 0,
    
    owners: (truth.ownership?.owners || [])
      .filter((o: any) => o.ownership_percentage >= 20)
      .map((o: any) => ({
        name: o.name || "",
        ssn: o.ssn || "",
        ownership_percentage: o.ownership_percentage || 0,
        address: {
          street: o.address?.street || "",
          city: o.address?.city || "",
          state: o.address?.state || "",
          zip: o.address?.zip || "",
        },
      })),
    
    use_of_proceeds: truth.loan?.use_of_proceeds || [],
    
    revenue_trailing_12: truth.financials?.revenue_trailing_12 || 0,
    ebitda: truth.financials?.ebitda || 0,
    debt_service_coverage_ratio: truth.financials?.dscr || 0,
    
    collateral_items: truth.collateral?.items || [],
  };
}

/**
 * Validate E-Tran data completeness
 */
function validateETranData(data: ETranData): string[] {
  const errors: string[] = [];
  
  if (!data.lender_id) errors.push("Missing SBA Lender ID");
  if (!data.service_center) errors.push("Missing SBA Service Center");
  
  if (!data.business_legal_name) errors.push("Missing business legal name");
  if (!data.business_ein) errors.push("Missing EIN");
  if (!data.business_address.street) errors.push("Missing business address");
  
  if (data.loan_amount <= 0) errors.push("Invalid loan amount");
  if (data.term_months <= 0) errors.push("Invalid loan term");
  if (data.interest_rate <= 0) errors.push("Invalid interest rate");
  
  if (!data.naics_code) errors.push("Missing NAICS code");
  if (data.naics_code.length !== 6) errors.push("NAICS code must be 6 digits");
  
  if (data.owners.length === 0) errors.push("At least one owner (>=20%) required");
  
  data.owners.forEach((owner, idx) => {
    if (!owner.name) errors.push(`Owner ${idx + 1}: Missing name`);
    if (!owner.ssn || owner.ssn.length !== 9) errors.push(`Owner ${idx + 1}: Invalid SSN`);
    if (owner.ownership_percentage < 20) errors.push(`Owner ${idx + 1}: Ownership < 20%`);
  });
  
  if (data.revenue_trailing_12 <= 0) errors.push("Missing revenue data");
  if (data.debt_service_coverage_ratio <= 0) errors.push("Missing DSCR");
  
  return errors;
}

/**
 * Build E-Tran XML structure
 */
function buildETranXML(data: ETranData): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    indentBy: "  ",
  });
  
  const xmlObj = {
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "UTF-8",
    },
    ETran: {
      "@_version": "3.0",
      Header: {
        LenderID: data.lender_id,
        ServiceCenter: data.service_center,
        SubmissionDate: new Date().toISOString().split("T")[0],
      },
      Borrower: {
        LegalName: data.business_legal_name,
        DBA: data.business_dba,
        EIN: data.business_ein,
        Address: {
          Street: data.business_address.street,
          City: data.business_address.city,
          State: data.business_address.state,
          Zip: data.business_address.zip,
        },
        NAICSCode: data.naics_code,
        BusinessType: data.business_type,
        NumberOfEmployees: data.number_of_employees,
      },
      Loan: {
        Amount: data.loan_amount,
        TermMonths: data.term_months,
        InterestRate: data.interest_rate,
        SBAGuaranteePercentage: data.sba_guarantee_percentage,
        UseOfProceeds: data.use_of_proceeds.map((uop) => ({
          Category: uop.category,
          Amount: uop.amount,
        })),
      },
      Owners: {
        Owner: data.owners.map((owner) => ({
          Name: owner.name,
          SSN: owner.ssn,
          OwnershipPercentage: owner.ownership_percentage,
          Address: {
            Street: owner.address.street,
            City: owner.address.city,
            State: owner.address.state,
            Zip: owner.address.zip,
          },
        })),
      },
      Financials: {
        RevenueTrailing12: data.revenue_trailing_12,
        EBITDA: data.ebitda,
        DSCR: data.debt_service_coverage_ratio,
      },
      Collateral: data.collateral_items.length > 0 ? {
        Item: data.collateral_items.map((item) => ({
          Type: item.type,
          Description: item.description,
          Value: item.value,
        })),
      } : undefined,
    },
  };
  
  return builder.build(xmlObj);
}

/**
 * Submit E-Tran XML (REQUIRES HUMAN APPROVAL)
 */
export async function submitETranXML(params: {
  dealId: string;
  bankId: string;
  xml: string;
  approvedBy: string;
}): Promise<{
  submitted: boolean;
  sba_application_number?: string;
  error?: string;
}> {
  const sb = supabaseAdmin();
  
  // Log submission attempt
  await sb.from("deal_events").insert({
    deal_id: params.dealId,
    bank_id: params.bankId,
    event_type: "etran_submission_attempt",
    event_data: {
      xml_length: params.xml.length,
      approved_by: params.approvedBy,
      timestamp: new Date().toISOString(),
    },
  });
  
  try {
    // In production, this would call SBA E-Tran API
    // For now, return success simulation
    
    const sbaApplicationNumber = `SBA-${Date.now()}`; // Mock number
    
    // Log successful submission
    await sb.from("deal_events").insert({
      deal_id: params.dealId,
      bank_id: params.bankId,
      event_type: "etran_submitted",
      event_data: {
        sba_application_number: sbaApplicationNumber,
        approved_by: params.approvedBy,
        submitted_at: new Date().toISOString(),
      },
    });
    
    return {
      submitted: true,
      sba_application_number: sbaApplicationNumber,
    };
  } catch (err: any) {
    console.error("[E-Tran] Submission failed:", err);
    
    // Log failed submission
    await sb.from("deal_events").insert({
      deal_id: params.dealId,
      bank_id: params.bankId,
      event_type: "etran_submission_failed",
      event_data: {
        error: err.message,
        timestamp: new Date().toISOString(),
      },
    });
    
    return {
      submitted: false,
      error: err.message,
    };
  }
}
