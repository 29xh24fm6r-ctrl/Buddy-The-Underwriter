export const PFS_SCHEDULES = {
  notes: {
    table: "borrower_pfs_notes_payable",
    title: "Notes payable",
    fields: {
      noteholder_name_address: "text",
      original_balance: "number",
      current_balance: "number",
      payment_amount: "number",
      payment_frequency: "text",
      collateral_description: "text",
    },
  },
  securities: {
    table: "borrower_pfs_securities",
    title: "Stocks and bonds",
    fields: {
      number_of_shares: "number",
      name_of_securities: "text",
      cost: "number",
      market_value_quotation_exchange: "text",
      date_of_quotation: "date",
      total_value: "number",
    },
  },
  property: {
    table: "borrower_pfs_real_estate",
    title: "Real estate",
    fields: {
      property_label: "text",
      property_type: "text",
      address: "text",
      date_purchased: "date",
      original_cost: "number",
      present_market_value: "number",
      mortgage_holder_name_address: "text",
      mortgage_account_number: "text",
      mortgage_balance: "number",
      mortgage_payment_per_month_year: "text",
      mortgage_status: "text",
    },
  },
} as const;
export type ScheduleKind = keyof typeof PFS_SCHEDULES;
