# BUDDY GOD TIER EXTRACTION & ANALYSIS SPECIFICATION

**Classification:** Internal — Architectural Specification  
**Version:** 1.0  
**Status:** REQUIRED FOR BANK TRUST  
**Scope:** Complete document intelligence, line-item registry, ratio universe, and cross-document reconciliation rules

---

## THE MANDATE: WHY GOD TIER IS NON-NEGOTIABLE

Banks extend credit based on data. Buddy is only as trustworthy as the completeness and accuracy of its extraction. A missed ratio, a miscalculated DSO, or an ignored K-1 income line is not a minor bug — it is a credit decision error that exposes a bank to regulatory scrutiny, loan losses, and reputational damage.

**God Tier means: every line item on every document type that a commercial underwriter would review is extracted, validated, cross-referenced, and surfaced with full traceability. Nothing is approximated. Nothing is omitted. Nothing is unversioned.**

### The 5 Pillars of God Tier Status

1. **COMPLETENESS** — Every document type, every form, every schedule, every line item in scope
2. **ACCURACY** — Extracted values match source documents with zero tolerance for systematic error
3. **TRACEABILITY** — Every fact traced to its source form, line number, and tax year
4. **RATIO MASTERY** — Every derived metric computed with the exact formula a credit analyst would use
5. **CROSS-DOCUMENT RECONCILIATION** — Values from different sources are compared and conflicts flagged

---

## SECTION 1: COMPLETE DOCUMENT TYPE UNIVERSE

| Document Type | IRS Form / Variant | Entity Type | Priority | Years Required |
|---|---|---|---|---|
| C-Corporation Return | Form 1120 | C-Corp | GOD TIER | 3 Years |
| S-Corporation Return | Form 1120-S | S-Corp | GOD TIER | 3 Years |
| Partnership Return | Form 1065 | Partnership / LLC | GOD TIER | 3 Years |
| S-Corp Shareholder K-1 | Schedule K-1 (1120-S) | S-Corp Owner | GOD TIER | 3 Years |
| Partnership Partner K-1 | Schedule K-1 (1065) | Partner / Member | GOD TIER | 3 Years |
| Personal Income Tax Return | Form 1040 | Individual | GOD TIER | 2–3 Years |
| Itemized Deductions | Schedule A | Individual | HIGH | 2–3 Years |
| Interest & Dividends | Schedule B | Individual | HIGH | 2–3 Years |
| Sole Proprietor Income/Loss | Schedule C | Sole Proprietor | GOD TIER | 2–3 Years |
| Capital Gains & Losses | Schedule D | Individual | HIGH | 2–3 Years |
| Supplemental Income (Rental/Pass-through) | Schedule E | Landlord / Investor | GOD TIER | 2–3 Years |
| Farm Income / Loss | Schedule F | Farmer | MEDIUM | 2–3 Years |
| Wage & Salary Income | W-2 | Employee | GOD TIER | 2–3 Years |
| Non-Employee Compensation | 1099-NEC | Independent Contractor | GOD TIER | 2–3 Years |
| Miscellaneous Income | 1099-MISC | Various | HIGH | 2–3 Years |
| Interest Income | 1099-INT | Individual | HIGH | 2–3 Years |
| Dividend Income | 1099-DIV | Individual | HIGH | 2–3 Years |
| Retirement / Pension | 1099-R | Retiree | MEDIUM | 2–3 Years |
| Social Security Benefits | SSA-1099 | Retiree | MEDIUM | Latest |
| Income Statement / P&L | CPA-Prepared / QBO / Internal | Business | GOD TIER | 3 Years + YTD |
| Balance Sheet | CPA-Prepared / QBO / Internal | Business | GOD TIER | 3 Years + Current |
| Cash Flow Statement | CPA-Prepared | Business | HIGH | 3 Years |
| Trailing 12-Month (T12) P&L | Management / QBO | Business | GOD TIER | Current |
| Personal Financial Statement | SBA 413 / Bank PFS | Guarantor | GOD TIER | Current |
| Rent Roll | Landlord-Prepared | CRE / Rental | GOD TIER | Current |
| Lease Agreement | Signed Lease | CRE / Business Tenant | HIGH | All Active |
| Appraisal Report | USPAP-Compliant | CRE / Equipment | HIGH | Within 12 Months |
| Business Bank Statements | Bank-Issued | Business | GOD TIER | 12 Months |
| Personal Bank Statements | Bank-Issued | Guarantor | HIGH | 3–6 Months |
| Articles of Incorporation / Organization | State-Filed | Entity | HIGH | Current |
| Operating Agreement / Bylaws | Entity Document | Entity | HIGH | Current |
| Business License | State / Local | Entity | MEDIUM | Current |
| Debt Schedule / Loan Summary | Bank-Prepared / Borrower | Business | GOD TIER | Current |
| Accounts Receivable Aging | QBO / Accountant | Business | HIGH | Current |
| Accounts Payable Aging | QBO / Accountant | Business | HIGH | Current |

---

## SECTION 2: BUSINESS TAX RETURN LINE ITEMS

### 2A. Form 1120 — C-Corporation

#### Income Lines

| Line | Field Name | Canonical Key | Notes |
|---|---|---|---|
| 1a | Gross receipts or sales | `gross_receipts` | Top-line revenue before returns |
| 1b | Returns and allowances | `returns_allowances` | Subtract from gross receipts |
| 1c | Net sales (1a − 1b) | `net_sales` | Computed; confirm against line 1c |
| 2 | Cost of goods sold (Schedule A) | `cogs` | From attached Sch A |
| 3 | Gross profit | `gross_profit` | Net sales minus COGS |
| 4 | Dividends and inclusions | `dividends` | From Sch C |
| 5 | Interest income | `interest_income` | |
| 6 | Gross rents | `rent_income` | |
| 7 | Gross royalties | `royalty_income` | |
| 8 | Capital gain net income | `capital_gain_net` | From Sch D |
| 9 | Net gain (loss) from Form 4797 | `form4797_gain_loss` | Asset sales |
| 10 | Other income | `other_income_total` | Must itemize if material |
| 11 | Total income | `total_income` | Sum of 3–10; verify arithmetic |

#### Deduction Lines

| Line | Field Name | Canonical Key | Notes |
|---|---|---|---|
| 12 | Compensation of officers | `officer_compensation` | From Sch E; key add-back item |
| 13 | Salaries and wages | `salaries_wages` | |
| 14 | Repairs and maintenance | `repairs_maintenance` | |
| 15 | Bad debts | `bad_debts` | |
| 16 | Rents | `rent_expense` | |
| 17 | Taxes and licenses | `taxes_licenses` | |
| 18 | Interest expense | `interest_expense` | KEY: used in coverage ratios |
| 19 | Charitable contributions | `charitable_contributions` | |
| 20 | Depreciation (Form 4562) | `depreciation` | KEY: add back to get EBITDA |
| 21 | Depletion | `depletion` | Add back; similar to depreciation |
| 22 | Advertising | `advertising` | |
| 23 | Pension / profit-sharing plans | `pension_contributions` | |
| 24 | Employee benefit programs | `employee_benefits` | |
| 26 | Other deductions | `other_deductions_detail` | Flag if >10% of revenue |
| 27 | Total deductions | `total_deductions` | Sum of 12–26 |

#### Tax Computation Lines

| Line | Field Name | Canonical Key | Notes |
|---|---|---|---|
| 28 | Taxable income before NOL | `taxable_income_pre_nol` | |
| 29a | Net operating loss (NOL) deduction | `nol_deduction` | Persistent NOLs = risk signal |
| 30 | Taxable income | `taxable_income` | |
| 31 | Total tax | `total_tax` | |

#### Critical Computed Items from 1120

```
EBIT         = Total Income − Total Deductions + Interest Expense
EBITDA       = EBIT + Depreciation + Depletion + Amortization
Adjusted NCF = Net Income + Depreciation + Amortization + Interest + Non-recurring Add-backs − Non-recurring Income
```

---

### 2B. Form 1120-S — S-Corporation

> **Critical Concepts Buddy Must Know Cold**
> - S-Corps are pass-through entities — income taxes paid at shareholder level, NOT at the corporate level
> - Line 21 Ordinary Business Income/Loss flows to each shareholder's K-1, Box 1
> - Officer compensation (W-2) is on Line 7/8 — this is DIFFERENT from distributions
> - Distributions (K-1 Line 16d) are NOT income — do not double-count
> - Shareholder loans to/from company on Schedule L — flag as related-party transactions

| Line | Field Name | Canonical Key | Notes |
|---|---|---|---|
| 1a | Gross receipts or sales | `gross_receipts` | |
| 2 | Cost of goods sold | `cogs` | |
| 3 | Gross profit | `gross_profit` | |
| 4 | Net gain (loss) from Form 4797 | `form4797_gain_loss` | |
| 5 | Other income (loss) | `other_income` | |
| 6 | Total income (loss) | `total_income` | |
| 7 | Compensation of officers | `officer_compensation` | W-2 wages; add back for cash flow |
| 8 | Salaries and wages | `salaries_wages` | |
| 9 | Repairs and maintenance | `repairs_maintenance` | |
| 10 | Bad debts | `bad_debts` | |
| 11 | Rents | `rent_expense` | |
| 12 | Taxes and licenses | `taxes_licenses` | |
| 13 | Interest expense | `interest_expense` | KEY ratio input |
| 14 | Depreciation (Form 4562) | `depreciation` | KEY add-back |
| 15 | Depletion | `depletion` | |
| 16 | Advertising | `advertising` | |
| 17 | Pension/profit-sharing/annuity | `pension_contributions` | |
| 18 | Employee benefit programs | `employee_benefits` | |
| 19 | Other deductions | `other_deductions_detail` | |
| 20 | Total deductions | `total_deductions` | |
| 21 | Ordinary business income (loss) | `ordinary_business_income` | **CRITICAL: flows to each K-1** |

#### Schedule K Items — All Shareholder Pass-Through Items

| K Item | Description | Canonical Key | Notes |
|---|---|---|---|
| 1 | Ordinary business income (loss) | `k_ordinary_income` | Box 1 on shareholder K-1 |
| 2 | Net rental real estate income (loss) | `k_rental_re_income` | Box 2 |
| 3a | Other gross rental income (loss) | `k_other_rental` | Box 3 |
| 4 | Interest income | `k_interest_income` | Box 4 |
| 5a | Ordinary dividends | `k_dividends_ordinary` | Box 5a |
| 5b | Qualified dividends | `k_dividends_qualified` | Box 5b |
| 6 | Net short-term capital gain (loss) | `k_st_cap_gain` | Box 7 |
| 7 | Net long-term capital gain (loss) | `k_lt_cap_gain` | Box 8a |
| 8 | Unrecaptured Section 1250 gain | `k_1250_gain` | Box 8c |
| 9 | Net Section 1231 gain (loss) | `k_1231_gain` | Box 9 |
| 10 | Other income (loss) | `k_other_income` | Box 10; itemize if material |
| 11 | Section 179 deduction | `k_sec179` | Box 11; add back for cash flow |
| 12a | Charitable contributions | `k_charitable` | Box 12a |
| 16a–d | Credits (various) | `k_credits` | Box 13 |
| 17a | Depreciation adjustment (AMT) | `k_depr_adj` | Box 15a |
| 19a | Distributions — cash | `k_distributions_cash` | Box 16d; **NOT income** |
| 19b | Distributions — property | `k_distributions_property` | Box 16e |
| 20a | Shareholder debt outstanding | `k_shareholder_debt` | Balance Sheet note |

---

### 2C. Form 1065 — Partnership / Multi-Member LLC

> **Critical Partnership Concepts Buddy Must Master**
> - Guaranteed payments to partners (Line 10) are deductible to the partnership but are **income** to the partner — always add back when computing partnership-level cash flow
> - Partner distributions (Schedule K, Line 19) are NOT income — return of equity
> - Capital accounts (Schedule L / K-1 Section L) track each partner's equity — negative capital accounts = credit risk flag
> - Special allocations: some partners may receive different shares of income/loss than their % ownership — always use the K-1, not ownership percentage

| Line | Field Name | Canonical Key | Notes |
|---|---|---|---|
| 1a | Gross receipts or sales | `gross_receipts` | |
| 1b | Returns and allowances | `returns_allowances` | |
| 2 | Cost of goods sold (Sch A) | `cogs` | |
| 3 | Gross profit | `gross_profit` | |
| 4 | Ordinary income from other partnerships | `partner_income_other` | |
| 5 | Net farm profit (loss) | `farm_income` | |
| 6 | Net gain (loss) from Form 4797 | `form4797_gain_loss` | |
| 7 | Other income (loss) | `other_income` | |
| 8 | Total income (loss) | `total_income` | |
| 9 | Salaries and wages (non-partner employees) | `salaries_wages` | |
| 10 | Guaranteed payments to partners | `guaranteed_payments` | **CRITICAL: add back for coverage** |
| 11 | Repairs and maintenance | `repairs_maintenance` | |
| 12 | Bad debts | `bad_debts` | |
| 13 | Rent | `rent_expense` | |
| 14 | Taxes and licenses | `taxes_licenses` | |
| 15 | Interest expense | `interest_expense` | KEY ratio input |
| 16a | Depreciation (Form 4562) | `depreciation` | KEY add-back |
| 16b | Less depreciation (Sch A) | `depreciation_sch_a` | |
| 16c | Depletion — not oil/gas | `depletion` | |
| 17 | Retirement plans | `retirement_plans` | |
| 18 | Employee benefit programs | `employee_benefits` | |
| 19 | Other deductions | `other_deductions_detail` | |
| 20 | Total deductions | `total_deductions` | |
| 21 | Ordinary business income (loss) | `ordinary_business_income` | Flows to each K-1 |

---

### 2D. Schedule K-1 — The Most Critical Extraction Point

> **The K-1 is where business income becomes personal income.** Every guarantor on a commercial loan with pass-through income will have K-1s. Buddy must extract ALL of the following from BOTH 1120-S and 1065 K-1s.
>
> ⚠️ **A guarantor may have K-1s from MULTIPLE entities. Buddy must aggregate all K-1 income across all entities before computing personal income or global DSCR.**

| Box # | Description | Canonical Key | Used In | Notes |
|---|---|---|---|---|
| Header | Partner/Shareholder Name | `k1_owner_name` | Identity | Match to guarantor |
| Header | EIN of Entity | `k1_entity_ein` | Identity | Cross-ref with business return |
| Header | Ownership % / Profit % | `k1_ownership_pct` | Income allocation | May differ from capital % |
| Header | Beginning capital account | `k1_cap_acct_begin` | Net Worth | Negative = red flag |
| Header | Ending capital account | `k1_cap_acct_end` | Net Worth | KEY for guarantor analysis |
| 1 | Ordinary business income (loss) | `k1_ordinary_income` | Personal income / DSCR | **MOST IMPORTANT LINE** |
| 2 | Net rental real estate income (loss) | `k1_rental_re_income` | Schedule E / DSCR | |
| 3 | Other net rental income (loss) | `k1_other_rental` | Schedule E | |
| 4 | Guaranteed payments (1065 only) | `k1_guaranteed_payments` | Personal income | Always income to recipient |
| 5a | Interest income | `k1_interest_income` | Schedule B | |
| 5b | Qualified dividends | `k1_qualified_dividends` | Schedule B | |
| 6a | Ordinary dividends | `k1_ordinary_dividends` | Schedule B | |
| 7 | Royalties | `k1_royalties` | Schedule E | |
| 8 | Net short-term capital gain (loss) | `k1_st_cap_gain` | Schedule D | |
| 9a | Net long-term capital gain (loss) | `k1_lt_cap_gain` | Schedule D | Exclude one-time gains |
| 10 | Net Section 1231 gain (loss) | `k1_1231_gain` | 4797 / Schedule D | |
| 11 | Other income (loss) — detail | `k1_other_income` | Varies | Must itemize |
| 12/13 | Section 179 deduction | `k1_sec179_deduction` | Add-back | Add back for cash flow |
| 16/19 | Cash distributions to partner | `k1_cash_distributions` | Liquidity check | **NOT income — return of equity** |
| 17/20 | Other information — codes (AH, etc.) | `k1_other_info` | Various | May contain UBIA, QBI info |

---

## SECTION 3: PERSONAL TAX RETURN LINE ITEMS

### 3A. Form 1040 — Core Lines

| Line | Description | Canonical Key | Notes |
|---|---|---|---|
| 1a | Total wages, salaries, tips | `wages_salaries` | From all W-2s; cross-ref W-2s |
| 1b | Household employee wages | `household_wages` | |
| 2b | Taxable interest | `taxable_interest` | From Sch B |
| 3b | Ordinary dividends | `ordinary_dividends` | From Sch B |
| 4b | IRA distributions — taxable | `ira_distributions` | |
| 5b | Pension / annuity — taxable | `pension_annuity` | |
| 6b | Social Security — taxable | `social_security_taxable` | |
| 7 | Capital gain (loss) | `capital_gain_net` | From Sch D; exclude one-time items |
| 8 | Other income — Schedule 1 | `other_income_sch1` | See Schedule 1 below |
| 9 | Total income | `total_income_1040` | Sum of all income lines |
| 10 | Adjustments to income (Schedule 1) | `adjustments_to_income` | |
| 11 | **Adjusted Gross Income (AGI)** | `agi` | **KEY benchmark for personal income** |
| 12a | Standard or itemized deductions | `deductions_total` | |
| 15 | Taxable income | `taxable_income_personal` | |
| 24 | Total tax | `total_tax_personal` | |
| 33 | Total payments | `total_payments_personal` | |
| 37 | Amount owed | `tax_owed` | Persistent tax debt = credit risk signal |

---

### 3B. Schedule 1 — Additional Income & Adjustments

> Schedule 1 is critically important. It contains many income items that affect borrower cash flow.

| Part I Line | Description | Canonical Key | Notes |
|---|---|---|---|
| 3 | Business income (loss) | `sch1_business_income` | From Schedule C(s) |
| 4 | Other gains or losses (Form 4797) | `sch1_4797_gain` | Usually one-time; flag |
| 5 | Rental real estate / royalties / partnerships | `sch1_rental_partnership` | **KEY: pulls from Sch E** |
| 6 | Farm income (loss) | `sch1_farm_income` | |
| 7 | Unemployment compensation | `sch1_unemployment` | Exclude — not recurring |
| 8a | Net operating loss | `sch1_nol` | Recurring NOLs = concern |
| 8b | Gambling winnings | `sch1_gambling` | Exclude — not recurring |
| **Part II Line 15** | Self-employment health insurance | `sch1_se_health_insurance` | Add back for cash flow |
| **Part II Line 17** | Self-employed SEP / SIMPLE / qualified plan | `sch1_sep_ira_contributions` | Add back for cash flow |

---

### 3C. Schedule C — Sole Proprietor Business Income

> **Multiple Schedule Cs are common. Extract each separately AND aggregate. NAICS code must be extracted for industry benchmarking.**

| Line | Field Name | Canonical Key | Notes |
|---|---|---|---|
| A | Principal business / profession | `sch_c_business_name` | Identify the business |
| B | NAICS code | `sch_c_naics` | Cross-ref with industry classification |
| 1 | Gross receipts or sales | `sch_c_gross_receipts` | Top-line revenue |
| 2 | Returns and allowances | `sch_c_returns` | |
| 3 | Net sales | `sch_c_net_sales` | |
| 4 | Cost of goods sold (Part III) | `sch_c_cogs` | |
| 5 | Gross profit | `sch_c_gross_profit` | |
| 6 | Other income | `sch_c_other_income` | |
| 7 | Gross income | `sch_c_gross_income` | |
| 8 | Advertising | `sch_c_advertising` | |
| 9 | Car and truck expenses | `sch_c_auto` | |
| 10 | Commissions and fees | `sch_c_commissions` | |
| 11 | Contract labor | `sch_c_contract_labor` | |
| 12 | Depletion | `sch_c_depletion` | Add back |
| 13 | Depreciation (Form 4562) | `sch_c_depreciation` | KEY add-back |
| 14 | Employee benefit programs | `sch_c_employee_benefits` | |
| 15 | Insurance (other than health) | `sch_c_insurance` | |
| 16a | Mortgage interest | `sch_c_mortgage_interest` | |
| 16b | Other interest | `sch_c_other_interest` | KEY ratio input |
| 17 | Legal and professional services | `sch_c_legal_professional` | |
| 18 | Office expense | `sch_c_office` | |
| 19 | Pension / profit-sharing plans | `sch_c_pension` | Add back for cash flow |
| 20a | Vehicle rent/lease | `sch_c_vehicle_rent` | |
| 20b | Other machinery/equipment rent | `sch_c_equipment_rent` | |
| 21 | Repairs and maintenance | `sch_c_repairs` | |
| 22 | Supplies | `sch_c_supplies` | |
| 23 | Taxes and licenses | `sch_c_taxes_licenses` | |
| 24a | Travel | `sch_c_travel` | |
| 24b | Meals (deductible portion) | `sch_c_meals` | |
| 25 | Utilities | `sch_c_utilities` | |
| 26 | Wages (less employment credits) | `sch_c_wages` | |
| 27a | Other expenses (detail) | `sch_c_other_expenses` | Must itemize if material |
| 28 | Total expenses | `sch_c_total_expenses` | |
| 30 | Business use of home | `sch_c_home_office` | Non-cash; add back |
| 31 | **Net profit (loss)** | `sch_c_net_profit` | **Flows to Schedule 1** |

---

### 3D. Schedule E — Supplemental Income

#### Part I — Rental Real Estate

| Line | Description | Canonical Key | Notes |
|---|---|---|---|
| Col A/B/C | Property address | `sch_e_property_address` | Each property listed separately |
| 3 | Rents received | `sch_e_rents_received` | Gross rental income |
| 4 | Royalties received | `sch_e_royalties_received` | |
| 5–19 | (All expense lines) | `sch_e_expense_[type]` | Advertising, maintenance, insurance, mgmt fees, etc. |
| 12 | Mortgage interest paid to banks | `sch_e_mortgage_interest` | KEY debt service component |
| 18 | Depreciation (Form 4562) | `sch_e_depreciation` | **KEY add-back for cash flow** |
| 22 | Net income or (loss) per property | `sch_e_net_per_property` | Aggregate all properties |
| 23a–c | Passive loss / carryover | `sch_e_passive_loss` | Watch for passive loss limitations |
| 26 | Total rental real estate income | `sch_e_rental_total` | **Flows to Schedule 1 Line 5** |

#### Part II — Partnerships, S-Corps (from K-1s)

| Line | Description | Canonical Key | Notes |
|---|---|---|---|
| Col A | Entity name | `sch_e_entity_name` | Cross-ref to business return |
| Col B | Passive / nonpassive flag | `sch_e_passive_flag` | Passive losses = limited deductibility |
| 28a | Passive income from S-Corp / Partnership | `sch_e_passive_income` | From K-1 |
| 28b | Nonpassive loss | `sch_e_nonpassive_loss` | From K-1 |
| 28c | Passive loss (with limitation) | `sch_e_passive_loss_limited` | |
| 28d | **Nonpassive income** | `sch_e_nonpassive_income` | **Most common for guarantor analysis** |

---

### 3E. W-2 — Wage & Salary Income

| Box | Description | Canonical Key | Notes |
|---|---|---|---|
| 1 | Wages, tips, other compensation | `w2_wages` | Primary income line |
| 2 | Federal income tax withheld | `w2_fed_tax_withheld` | |
| 3 | Social Security wages | `w2_ss_wages` | May differ from Box 1 |
| 4 | Social Security tax withheld | `w2_ss_tax` | |
| 5 | Medicare wages and tips | `w2_medicare_wages` | |
| 6 | Medicare tax withheld | `w2_medicare_tax` | |
| 10 | Dependent care benefits | `w2_dep_care` | |
| 11 | Nonqualified deferred compensation | `w2_nqdc` | |
| 12 | Codes — D (401k), W (HSA), AA (Roth), etc. | `w2_box12_detail` | Each code must be extracted |
| 13 | Statutory / retirement / third party sick | `w2_checkboxes` | |
| 14 | Other (state/union dues/etc.) | `w2_other_detail` | |
| c | Employer name and address | `w2_employer_name` | Cross-ref with business ownership |
| e | Employee name | `w2_employee_name` | Match to borrower / guarantor |
| f | Employee SSN (last 4) | `w2_ssn_last4` | Last 4 only; match to 1040 |

---

### 3F. 1099 Forms — All Variants

| Form / Box | Description | Canonical Key | Notes |
|---|---|---|---|
| 1099-NEC Box 1 | Nonemployee compensation | `1099nec_nonemployee_comp` | Self-employment income; subject to SE tax |
| 1099-MISC Box 1 | Rents | `1099misc_rents` | Cross-ref Schedule E |
| 1099-MISC Box 2 | Royalties | `1099misc_royalties` | Cross-ref Schedule E |
| 1099-MISC Box 3 | Other income | `1099misc_other_income` | |
| 1099-MISC Box 6 | Medical/healthcare payments | `1099misc_medical` | Often business-related |
| 1099-INT Box 1 | Interest income | `1099int_interest` | Cross-ref Schedule B |
| 1099-INT Box 3 | Interest on US Savings Bonds | `1099int_us_savings` | |
| 1099-INT Box 8 | Tax-exempt interest | `1099int_tax_exempt` | Municipal bonds; include in income analysis |
| 1099-DIV Box 1a | Total ordinary dividends | `1099div_ordinary` | Cross-ref Schedule B |
| 1099-DIV Box 1b | Qualified dividends | `1099div_qualified` | |
| 1099-DIV Box 2a | Total capital gain distributions | `1099div_cap_gain` | |
| 1099-R Box 1 | Gross distribution | `1099r_gross_distribution` | |
| 1099-R Box 2a | Taxable amount | `1099r_taxable` | Cross-ref 1040 Line 5b |
| 1099-R Box 7 | Distribution code | `1099r_distribution_code` | Early withdrawal = penalty flag |
| SSA-1099 Box 5 | Net benefits received | `ssa1099_net_benefits` | Social Security; 85% may be taxable |

---

## SECTION 4: FINANCIAL STATEMENT LINE ITEMS

### 4A. Income Statement / P&L

| Category | Line Item | Canonical Key | Notes |
|---|---|---|---|
| Revenue | Gross sales / revenue | `is_gross_revenue` | |
| Revenue | Sales returns and allowances | `is_sales_returns` | |
| Revenue | **Net revenue** | `is_net_revenue` | Primary top-line figure |
| Revenue | Other operating revenue | `is_other_revenue` | Detail required if >5% |
| COGS | Beginning inventory | `is_begin_inventory` | For DIO computation |
| COGS | Purchases / raw materials | `is_purchases` | |
| COGS | Direct labor | `is_direct_labor` | |
| COGS | Manufacturing overhead | `is_mfg_overhead` | |
| COGS | Ending inventory | `is_end_inventory` | For DIO computation |
| COGS | **Total cost of goods sold** | `is_cogs` | KEY for all margin ratios |
| Gross Profit | **Gross profit** | `is_gross_profit` | = Net Revenue − COGS |
| OpEx | Salaries, wages, payroll taxes | `is_salaries_total` | |
| OpEx | Owner / officer compensation | `is_officer_compensation` | Key add-back |
| OpEx | Rent / facility costs | `is_rent_expense` | |
| OpEx | Utilities | `is_utilities` | |
| OpEx | Repairs and maintenance | `is_repairs` | |
| OpEx | Insurance | `is_insurance` | |
| OpEx | Marketing / advertising | `is_advertising` | |
| OpEx | Professional services | `is_professional_fees` | |
| OpEx | Technology / software | `is_technology` | |
| OpEx | Travel and entertainment | `is_travel_entertainment` | |
| OpEx | Vehicle expenses | `is_vehicle` | |
| OpEx | **Depreciation** | `is_depreciation` | **KEY add-back** |
| OpEx | **Amortization** | `is_amortization` | **KEY add-back** |
| OpEx | Bad debt expense | `is_bad_debt` | |
| OpEx | Other operating expenses | `is_other_opex` | Itemize if >5% |
| OpEx | Total operating expenses | `is_total_opex` | |
| Sub-total | **Operating income (EBIT)** | `is_ebit` | = Gross Profit − OpEx |
| Sub-total | **EBITDA** | `is_ebitda` | = EBIT + Depreciation + Amortization |
| Below Line | Interest income | `is_interest_income` | |
| Below Line | **Interest expense** | `is_interest_expense` | KEY: separate from operating |
| Below Line | Gain/loss on asset sales | `is_gain_loss_assets` | Flag as non-recurring |
| Below Line | Income before taxes (EBT) | `is_ebt` | = EBIT + Below-Line Items |
| Below Line | Income tax expense | `is_income_tax_expense` | N/A for pass-throughs at entity level |
| Net Income | **Net income (loss)** | `is_net_income` | Bottom line |

---

### 4B. Balance Sheet

#### Assets

| Category | Line Item | Canonical Key | Notes |
|---|---|---|---|
| Current Assets | Cash and cash equivalents | `bs_cash` | KEY: days cash on hand |
| Current Assets | Restricted cash | `bs_restricted_cash` | Cannot count for liquidity |
| Current Assets | Marketable securities | `bs_marketable_securities` | |
| Current Assets | Accounts receivable — gross | `bs_ar_gross` | **KEY: DSO computation** |
| Current Assets | Allowance for doubtful accounts | `bs_ar_allowance` | |
| Current Assets | **Accounts receivable — net** | `bs_ar_net` | = Gross − Allowance |
| Current Assets | **Inventory** | `bs_inventory` | **KEY: DIO computation** |
| Current Assets | Prepaid expenses | `bs_prepaid_expenses` | |
| Current Assets | Notes receivable — current | `bs_notes_receivable_current` | |
| Current Assets | Other current assets | `bs_other_current_assets` | |
| Current Assets | **TOTAL CURRENT ASSETS** | `bs_total_current_assets` | **KEY liquidity ratio input** |
| Non-Current | PP&E — gross | `bs_ppe_gross` | |
| Non-Current | Accumulated depreciation | `bs_accumulated_depreciation` | |
| Non-Current | **PP&E — net** | `bs_ppe_net` | KEY: fixed asset turnover |
| Non-Current | Intangible assets — net | `bs_intangibles_net` | **Subtract for Tangible Net Worth** |
| Non-Current | **Goodwill** | `bs_goodwill` | **Subtract for Tangible Net Worth** |
| Non-Current | Long-term investments | `bs_lt_investments` | |
| Non-Current | **Loans to owners / related parties** | `bs_related_party_loans` | **RED FLAG: flag always** |
| Non-Current | Other non-current assets | `bs_other_noncurrent_assets` | |
| Total | **TOTAL ASSETS** | `bs_total_assets` | **KEY leverage ratio denominator** |

#### Liabilities

| Category | Line Item | Canonical Key | Notes |
|---|---|---|---|
| Current Liabilities | **Accounts payable** | `bs_accounts_payable` | **KEY: DPO computation** |
| Current Liabilities | Accrued liabilities | `bs_accrued_liabilities` | |
| Current Liabilities | Accrued payroll and benefits | `bs_accrued_payroll` | |
| Current Liabilities | Income taxes payable | `bs_income_tax_payable` | Tax arrears = red flag |
| Current Liabilities | Deferred revenue — current | `bs_deferred_revenue_current` | Not cash flow; adjust |
| Current Liabilities | **Line of credit / revolver** | `bs_revolver_balance` | **KEY debt service item** |
| Current Liabilities | **Current maturities of LT debt** | `bs_cmltd` | **KEY debt service item** |
| Current Liabilities | Notes payable — current | `bs_notes_payable_current` | |
| Current Liabilities | Owner / shareholder loans payable | `bs_owner_loans_payable` | Related party; flag |
| Current Liabilities | **TOTAL CURRENT LIABILITIES** | `bs_total_current_liabilities` | **KEY liquidity ratio denominator** |
| Long-Term | **Long-term debt (net of current)** | `bs_lt_debt` | KEY leverage input |
| Long-Term | SBA / USDA loans | `bs_sba_loans` | |
| Long-Term | Mortgage payable | `bs_mortgage_payable` | |
| Long-Term | Capital lease obligations | `bs_capital_leases` | Treat as debt |
| Long-Term | Deferred tax liability | `bs_deferred_tax_liability` | |
| Long-Term | **TOTAL LONG-TERM LIABILITIES** | `bs_total_lt_liabilities` | |
| Long-Term | **TOTAL LIABILITIES** | `bs_total_liabilities` | KEY leverage input |

#### Equity

| Category | Line Item | Canonical Key | Notes |
|---|---|---|---|
| Equity | Common stock / paid-in capital | `bs_common_stock` | |
| Equity | Additional paid-in capital | `bs_apic` | |
| Equity | **Retained earnings / (accumulated deficit)** | `bs_retained_earnings` | Persistent deficits = concern |
| Equity | Owner's draw / distributions YTD | `bs_distributions_ytd` | Reduces equity |
| Equity | Treasury stock | `bs_treasury_stock` | |
| Equity | **TOTAL STOCKHOLDERS' EQUITY** | `bs_total_equity` | KEY leverage denominator |
| Equity | **TOTAL LIABILITIES + EQUITY** | `bs_total_liab_equity` | Must equal Total Assets |
| Computed | **Tangible Net Worth** | `bs_tangible_net_worth` | = Total Equity − Intangibles − Goodwill |
| Computed | **Net Working Capital** | `bs_working_capital` | = Current Assets − Current Liabilities |
| Computed | **Total Funded Debt** | `bs_total_funded_debt` | = All interest-bearing debt |

---

## SECTION 5: COMPLETE RATIO UNIVERSE

### 5A. Liquidity Ratios

| Ratio Name | Exact Formula | Canonical Key | Benchmarks |
|---|---|---|---|
| Current Ratio | Total Current Assets ÷ Total Current Liabilities | `ratio_current` | ≥1.25 adequate; ≥2.0 strong; <1.0 = concern |
| Quick Ratio (Acid Test) | (Cash + Securities + Net A/R) ÷ Total Current Liabilities | `ratio_quick` | ≥1.0 strong; <0.5 = concern; excludes inventory |
| Cash Ratio | Cash & Equivalents ÷ Total Current Liabilities | `ratio_cash` | Most conservative liquidity measure |
| Net Working Capital ($) | Total Current Assets − Total Current Liabilities | `wc_dollars` | Positive = buffer; negative = short-term stress |
| Working Capital Turnover | Net Revenue ÷ Average Net Working Capital | `ratio_wc_turnover` | High = efficient working capital use |
| Days Cash on Hand | (Cash ÷ (Total OpEx − Non-Cash Items)) × 365 | `ratio_days_cash` | 30 days = minimum; 60+ = healthy; 90+ = strong |

---

### 5B. Activity / Efficiency Ratios

> These are the Moody's-level metrics most banks scrutinize. Buddy must compute all of them.

| Ratio Name | Exact Formula | Canonical Key | Benchmarks |
|---|---|---|---|
| **Days Sales Outstanding (DSO)** | (Net Accounts Receivable ÷ Net Sales) × 365 | `ratio_dso` | Lower = faster collections; >90 days = concern |
| **Days Inventory Outstanding (DIO)** | (Inventory ÷ Cost of Goods Sold) × 365 | `ratio_dio` | Lower = faster turns; high DIO = obsolescence risk |
| **Days Payable Outstanding (DPO)** | (Accounts Payable ÷ Cost of Goods Sold) × 365 | `ratio_dpo` | Higher = supplier financing; too high = vendor risk |
| **Cash Conversion Cycle (CCC)** | DSO + DIO − DPO | `ratio_ccc` | Lower is better; negative CCC = cash machine |
| Accounts Receivable Turnover | Net Sales ÷ Average Accounts Receivable | `ratio_ar_turnover` | Higher = faster collections |
| Inventory Turnover | COGS ÷ Average Inventory | `ratio_inventory_turnover` | Higher = faster moving inventory |
| Asset Turnover | Net Revenue ÷ Total Average Assets | `ratio_asset_turnover` | Revenue per dollar of assets |
| Fixed Asset Turnover | Net Revenue ÷ Net PP&E | `ratio_fixed_asset_turnover` | How hard fixed assets are working |
| Revenue per Employee | Net Revenue ÷ FTE Count | `ratio_rev_per_fte` | Productivity benchmark |

---

### 5C. Leverage / Solvency Ratios

| Ratio Name | Exact Formula | Canonical Key | Benchmarks |
|---|---|---|---|
| **Total Debt / EBITDA** | All Interest-Bearing Debt ÷ EBITDA | `ratio_debt_ebitda` | ≤3.0x = good; ≤4.5x = acceptable; >5.0x = concern |
| **Senior Debt / EBITDA** | Senior Secured Debt ÷ EBITDA | `ratio_senior_debt_ebitda` | Moody's key leverage metric; ≤2.5x = low risk |
| Total Liabilities / Total Assets | Total Liabilities ÷ Total Assets | `ratio_liabilities_to_assets` | ≤0.60 = conservative; >0.80 = highly leveraged |
| Debt-to-Equity (D/E) | Total Interest-Bearing Debt ÷ Total Equity | `ratio_debt_equity` | ≤2.0x = manageable; >4.0x = concern |
| **Total Liabilities / Tangible Net Worth** | Total Liabilities ÷ Tangible Net Worth | `ratio_liab_tnw` | Moody's standard; ≤3.0x = strong |
| Leverage Ratio (Assets/Equity) | Total Assets ÷ Total Equity | `ratio_leverage_ae` | >5x = high risk |
| Interest Coverage (ICR) | EBIT ÷ Interest Expense | `ratio_icr` | ≥3.0x = strong; <1.5x = concern; <1.0x = distress |
| Fixed Charge Coverage (FCCR) | (EBIT + Lease Payments) ÷ (Interest + Leases + CMLTD) | `ratio_fccr` | ≥1.25x = minimum; ≥1.50x = comfortable |
| **DSCR — Business** | Net Operating Income ÷ Total Annual Debt Service | `ratio_dscr_business` | ≥1.25x = minimum; ≥1.35x = comfortable; <1.0x = fail |
| **DSCR — Global** | (Business + Personal Cash Flow) ÷ Total Debt Service | `ratio_dscr_global` | ≥1.25x = most bank minimums; must include ALL obligations |
| **Tangible Net Worth ($)** | Total Equity − Intangible Assets − Goodwill | `tnw_dollars` | Absolute floor; most policies require positive TNW |
| TNW / Total Assets | Tangible Net Worth ÷ Total Assets | `ratio_tnw_to_assets` | Higher = more equity cushion |
| Net Debt | Total Interest-Bearing Debt − Cash | `net_debt_dollars` | True debt burden; can be negative if cash-rich |

---

### 5D. Profitability Ratios

| Ratio Name | Exact Formula | Canonical Key | Benchmarks |
|---|---|---|---|
| Gross Profit Margin | (Net Revenue − COGS) ÷ Net Revenue × 100 | `ratio_gross_margin_pct` | Industry-dependent; declining = input cost pressure |
| **EBITDA Margin** | EBITDA ÷ Net Revenue × 100 | `ratio_ebitda_margin_pct` | ≥15% = good operating business |
| Operating Profit Margin (EBIT Margin) | EBIT ÷ Net Revenue × 100 | `ratio_ebit_margin_pct` | |
| Net Profit Margin | Net Income ÷ Net Revenue × 100 | `ratio_net_margin_pct` | After tax; compare to pre-tax for pass-throughs |
| Return on Assets (ROA) | Net Income ÷ Average Total Assets × 100 | `ratio_roa_pct` | ≥5% = solid; <2% = low return |
| Return on Equity (ROE) | Net Income ÷ Average Total Equity × 100 | `ratio_roe_pct` | ≥10% = good; compare to industry |
| Revenue Growth Rate | (Current Yr − Prior Yr) ÷ Prior Yr × 100 | `ratio_revenue_growth_pct` | Negative = declining; >20% = verify quality |
| EBITDA Growth Rate | (Current EBITDA − Prior EBITDA) ÷ Prior EBITDA × 100 | `ratio_ebitda_growth_pct` | |

---

### 5E. CRE-Specific Ratios

| Ratio Name | Exact Formula | Canonical Key | Benchmarks |
|---|---|---|---|
| **Net Operating Income (NOI)** | Effective Gross Income − Operating Expenses (excl. debt service) | `cre_noi` | Core CRE profitability metric; before mortgage |
| **Debt Service Coverage (NOI-Based)** | NOI ÷ Annual Debt Service (P+I) | `cre_dscr` | ≥1.25x typical minimum; SBA: ≥1.15x |
| **Debt Yield** | NOI ÷ Proposed Loan Amount × 100 | `cre_debt_yield_pct` | ≥8.0% = typical minimum; LTV-independent risk measure |
| **Loan-to-Value (LTV)** | Loan Amount ÷ Appraised Value × 100 | `cre_ltv_pct` | ≤65% = low risk; ≤75% = standard; >80% = typically needs SBA |
| Loan-to-Cost (LTC) | Loan Amount ÷ Total Project Cost × 100 | `cre_ltc_pct` | Construction / acquisition metric |
| Cap Rate | NOI ÷ Property Value × 100 | `cre_cap_rate_pct` | Compare to area cap rates |
| Break-Even Occupancy | (Debt Service + Fixed Expenses) ÷ Gross Potential Rent × 100 | `cre_breakeven_occ_pct` | Lower = safer |
| Effective Gross Income (EGI) | Gross Potential Rent − Vacancy & Credit Loss | `cre_egi` | Realistic revenue after vacancy |
| Vacancy Rate | Vacant Units ÷ Total Units × 100 | `cre_vacancy_pct` | From rent roll; compare to market |
| Occupancy Rate | Occupied Units ÷ Total Units × 100 | `cre_occupancy_pct` | >90% = strong |
| **Weighted Average Lease Term (WALT)** | Sum of (Remaining Lease Term × % of Rent) for each tenant | `cre_walt_months` | Longer = more stable income |
| Price per Square Foot | Appraised Value ÷ Gross Leasable Area | `cre_price_per_sqft` | Compare to market comps |
| NOI per Square Foot | NOI ÷ Gross Leasable Area | `cre_noi_per_sqft` | |

---

### 5F. Personal / Guarantor Financial Ratios

| Ratio Name | Exact Formula | Canonical Key | Notes |
|---|---|---|---|
| Personal Net Worth | Total Personal Assets − Total Personal Liabilities (PFS) | `personal_net_worth` | Must be positive; compare to loan amount |
| Personal Liquidity | Liquid Assets ÷ Proposed Loan Amount × 100 | `personal_liquidity_pct` | Ability to inject capital if needed |
| Personal DSCR | Total Personal Income (from 1040) ÷ Total Personal Debt Service | `personal_dscr` | |
| **Global DSCR** | (Business Cash Flow + Personal Income) ÷ Total Debt Service | `global_dscr` | **THE master coverage ratio** |
| Contingent Liabilities | All guarantees of other debt from PFS | `contingent_liabilities_total` | Can blow up global DSCR unexpectedly |
| Personal K-1 Aggregate Income | Sum of all K-1 Box 1 × ownership % across all entities | `k1_aggregate_income` | Cross-ref to Schedule E Part II |
| W-2 Income Stability (2yr avg) | (Year 1 W-2 + Year 2 W-2) ÷ 2 | `w2_2yr_avg` | Per GSE / SBA guidelines |
| Self-Employment Income (2yr avg) | (Year 1 SE Income + Year 2 SE Income) ÷ 2 | `se_income_2yr_avg` | Only use if consistent or increasing; declining = disqualifying |
| Debt-to-Income (DTI) | Total Monthly Debt Payments ÷ Gross Monthly Income × 100 | `personal_dti_pct` | Personal complement to global DSCR |
| Post-Close Liquidity | Remaining Liquid Assets After Down Payment + Closing Costs | `post_close_liquidity` | Must meet bank minimums (usually 10–20% of loan) |

---

### 5G. Year-over-Year Trend Analysis

Buddy must track all key metrics across 3 years and characterize the trajectory:

| Trend Metric | Characterization Options | Canonical Key | Risk Signal |
|---|---|---|---|
| Revenue trend (3yr) | Positive / Neutral / Declining | `trend_revenue` | Declining 2+ years = material risk |
| EBITDA trend (3yr) | Positive / Neutral / Declining | `trend_ebitda` | |
| Gross margin trend | Expanding / Stable / Compressing | `trend_gross_margin` | Compression = input cost or pricing pressure |
| DSO trend | Improving / Stable / Deteriorating | `trend_dso` | Rising DSO = collection problems emerging |
| DIO trend | Improving / Stable / Deteriorating | `trend_dio` | Rising DIO = inventory buildup / demand softening |
| Leverage trend (Debt/EBITDA) | Improving / Stable / Worsening | `trend_leverage` | Worsening = balance sheet deterioration |
| Coverage trend (DSCR) | Improving / Stable / Declining | `trend_dscr` | |
| Net worth trend | Growing / Stable / Eroding | `trend_net_worth` | Consistent erosion = fundamental issue |

---

## SECTION 6: CROSS-DOCUMENT RECONCILIATION RULES

### 6A. Revenue Reconciliation

- **Tax Return Revenue** (1120/1120-S/1065 Line 1) ↔ **Financial Statement Revenue**: tolerance ≤5% or $25K; flag if greater
- **Bank Statement Deposits** ↔ **Reported Revenue**: large unexplained variances may indicate unreported income or overstatement
- **T12 YTD Revenue × (12/months elapsed)** ↔ **Prior Year Revenue**: flag if annualized pace deviates >15%
- **Schedule C Revenue** ↔ **1099-NEC amounts received**: cross-ref for completeness

### 6B. Income / DSCR Reconciliation

- **K-1 Income on Schedule E Part II** ↔ **K-1 source entity Box 1**: must match exactly
- **W-2 wages on 1040 Line 1a** ↔ **Sum of all W-2 Box 1 amounts**: must reconcile
- **Officer compensation on business return** ↔ **W-2s issued to officers**: must reconcile
- **Personal 1040 total income** ↔ **PFS stated income**: flag material discrepancies

### 6C. Balance Sheet Reconciliation

- **Total Assets = Total Liabilities + Total Equity**: must always balance; flag if off by any amount
- **A/R on Balance Sheet** ↔ **A/R aging report**: spot-check for aging data consistency
- **Inventory on Balance Sheet** ↔ **Tax return COGS schedule** beginning/ending inventory
- **Long-term debt on Balance Sheet** ↔ **Existing debt schedule**: each loan must reconcile
- **Related party balances**: flag any loans to/from owners, officers, or related entities

### 6D. Debt Schedule Completeness

- All interest-bearing liabilities on the Balance Sheet must appear in the debt schedule
- Debt schedule payments must be fully included in DSCR computation — no partial inclusion
- Hidden off-balance-sheet obligations: operating leases (post-ASC 842 now on-balance), guarantees, SBA loans not yet funded

---

## SECTION 7: GOD TIER QUALITY GATES

### 7A. Extraction Confidence Thresholds

| Confidence Tier | Score Range | Meaning | Action |
|---|---|---|---|
| Tier 1 — High Confidence | >0.90 | Deterministic pattern with exact line match | Use directly; display to banker |
| Tier 2 — Medium Confidence | 0.70–0.89 | Heuristic match or OCR ambiguity | Use with amber warning; require banker confirmation |
| Tier 3 — Low Confidence | 0.50–0.69 | Inferred or partially extracted | Flag in red; require manual override before use in ratios |
| Tier 4 — Not Found | <0.50 or null | Line item not found in document | Mark as missing; block ratio if it is a required input |

### 7B. Non-Negotiable Computation Rules

1. **DSCR must ALWAYS include 100% of all debt service** — no cherry-picking of obligations
2. **Pass-through income** (K-1, Schedule C, Schedule E) **must use 2-year average** unless current year is lower — always use lower of 2-year average vs. current year
3. **Depreciation add-backs** are only valid to the extent that capital expenditures are not understated — flag if CapEx is suspiciously low vs. depreciation
4. **Non-recurring income** (one-time gains, PPP forgiveness, insurance proceeds) must be **excluded** from base DSCR
5. **Non-recurring expenses** (one-time legal costs, disaster losses) may be added back only with documentation
6. **Officer compensation add-backs**: add back only amounts above documented market rate for the role
7. **All ratios must be traceable** to source line items with version stamps — no ratio can exist without a provenance chain

### 7C. Automatic Red Flag Triggers

| Condition | Flag Level |
|---|---|
| Negative tangible net worth | CRITICAL |
| DSCR < 1.0x | FAIL — do not proceed without committee review |
| DSO > 90 days | ELEVATED RISK |
| DIO > 180 days | ELEVATED RISK |
| Revenue declining 2+ consecutive years | DECLINING TREND |
| Tax liability owed >$10K on personal return | UNPAID TAX RISK |
| Related party loans > 10% of total assets | SCRUTINY REQUIRED |
| Negative capital account on K-1 | EQUITY EROSION |
| Operating loss 2+ consecutive years | CONCERN |
| Leverage (Debt/EBITDA) > 5.0x | HIGHLY LEVERAGED |
| Persistent NOLs (3+ years) | STRUCTURAL LOSS RISK |
| Deferred revenue growing faster than revenue | QUALITY OF EARNINGS CONCERN |

---

## IMPLEMENTATION NOTES FOR CLAUDE CODE

### Canonical Key Naming Convention

All extracted facts should be stored using the `canonical_key` values defined in this spec. The naming pattern is:

- `{form_prefix}_{field_snake_case}` for form-level extractions (e.g., `sch_c_depreciation`)
- `{prefix}_{metric_snake_case}` for computed ratios (e.g., `ratio_dso`, `cre_dscr`)
- `k1_{field}` for K-1 items
- `bs_`, `is_` prefixes for balance sheet and income statement items

### Extraction Priority Order

When the same value appears in multiple sources, use this precedence:

1. **Tax return** (IRS-filed = highest authority)
2. **CPA-prepared financial statement** (audited or reviewed)
3. **Internal / management-prepared financials**
4. **Bank statement deposits** (for revenue cross-check only)

### Ratio Computation Prerequisites

Before computing any ratio, verify that all required inputs have a confidence score ≥ Tier 2 (0.70+). If any required input is Tier 3 or 4, the ratio should be flagged as `low_confidence` and surfaced to the banker for manual review rather than blocked entirely.

### Multi-Year Data Handling

- Store each year's facts independently with `tax_year` as a key dimension
- Never overwrite year N data when extracting year N+1
- Trend computations require at minimum 2 years; 3 years is the standard
- When only 1 year is available, ratios are computed but trend fields are `null`

---

## THE GOD TIER DEFINITION

Buddy achieves God Tier when a credit analyst at any bank can hand him a full deal package — every form, every schedule, every statement — and Buddy returns a complete, fully reconciled, fully traced, ratio-complete analysis that the analyst can sign off on without re-extracting a single number.

**Every line item in this spec is a commitment. Buddy extracts it, verifies it, computes from it, and explains it — no exceptions.**
