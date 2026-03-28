/**
 * Phase 65F — Borrower Request Catalog
 *
 * Borrower-safe item templates. Plain English, no internal jargon.
 * Never expose internal codes, confidence levels, or advisory references.
 */

import type { BorrowerEvidenceType } from "./types";

export type BorrowerCatalogEntry = {
  itemCode: string;
  title: string;
  description: string;
  evidenceType: BorrowerEvidenceType;
  required: boolean;
};

export const BORROWER_REQUEST_CATALOG: Record<string, BorrowerCatalogEntry> = {
  upload_tax_returns: {
    itemCode: "upload_tax_returns",
    title: "Upload Tax Returns",
    description:
      "Please upload the requested tax return documents for this application.",
    evidenceType: "document_submit",
    required: true,
  },
  upload_financial_statements: {
    itemCode: "upload_financial_statements",
    title: "Upload Financial Statements",
    description:
      "Please upload the requested business financial statements.",
    evidenceType: "document_submit",
    required: true,
  },
  upload_pfs: {
    itemCode: "upload_pfs",
    title: "Upload Personal Financial Statement",
    description:
      "Please provide a current personal financial statement.",
    evidenceType: "document_submit",
    required: true,
  },
  upload_rent_roll: {
    itemCode: "upload_rent_roll",
    title: "Upload Rent Roll",
    description:
      "Please provide a current rent roll for the subject property.",
    evidenceType: "document_submit",
    required: true,
  },
  upload_bank_statements: {
    itemCode: "upload_bank_statements",
    title: "Upload Bank Statements",
    description:
      "Please upload the most recent bank statements as requested.",
    evidenceType: "document_submit",
    required: true,
  },
  upload_general_documents: {
    itemCode: "upload_general_documents",
    title: "Upload Requested Documents",
    description:
      "Please upload the documents your lender has requested.",
    evidenceType: "document_upload",
    required: true,
  },
  complete_borrower_information: {
    itemCode: "complete_borrower_information",
    title: "Complete Borrower Information",
    description:
      "Please complete the remaining borrower information for this application.",
    evidenceType: "form_completion",
    required: true,
  },
  confirm_extracted_fields: {
    itemCode: "confirm_extracted_fields",
    title: "Confirm Document Details",
    description:
      "Please review and confirm the details we extracted from your uploaded documents.",
    evidenceType: "field_confirmation",
    required: true,
  },
  provide_additional_collateral: {
    itemCode: "provide_additional_collateral",
    title: "Provide Collateral Documentation",
    description:
      "Please upload documentation for any additional collateral being pledged.",
    evidenceType: "document_submit",
    required: true,
  },
  provide_guarantor_docs: {
    itemCode: "provide_guarantor_docs",
    title: "Provide Guarantor Documentation",
    description:
      "Please upload the guarantor's current personal financial statement and identification.",
    evidenceType: "document_submit",
    required: true,
  },
};
