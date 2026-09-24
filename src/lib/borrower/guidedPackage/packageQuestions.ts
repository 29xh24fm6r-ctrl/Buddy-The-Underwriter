import { DISCOVERY_QUESTIONS } from "../journey/discovery";
// Package interview prompts; form controls are supplied by the existing SBA registry.
export const PACKAGE_QUESTIONS = [
  ...DISCOVERY_QUESTIONS,
  {
    id: "A01",
    section: " Your request and project",
    question: "What do you want this financing to help you accomplish?",
  },
  {
    id: "A02",
    section: " Your request and project",
    question:
      "Are you starting, acquiring, expanding, refinancing, buying property, buying equipment, or combining purposes?",
  },
  {
    id: "A03",
    section: " Your request and project",
    question: "How much financing are you requesting?",
  },
  {
    id: "A04",
    section: " Your request and project",
    question: "What is the total project cost?",
  },
  {
    id: "A05",
    section: " Your request and project",
    question:
      "How will the money be divided among purchase price, property, equipment, inventory, improvements, working capital, refinancing, and fees?",
  },
  {
    id: "A06",
    section: " Your request and project",
    question:
      "What expenses have you already paid, on what dates, and from which accounts?",
  },
  {
    id: "A07",
    section: " Your request and project",
    question:
      "When do you need the financing, and what contract or other deadlines apply?",
  },
  {
    id: "A08",
    section: " Your request and project",
    question: "What businesses and properties are involved in this project?",
  },
  {
    id: "A09",
    section: " Your request and project",
    question:
      "Are there other funding sources or lenders involved, and what are their terms?",
  },
  {
    id: "A10",
    section: " Your request and project",
    question:
      "Have you selected a loan program or lender, or would you like help determining the applicable application path?",
  },
  {
    id: "B01",
    section: " Business identity and organization",
    question: "What is the business's full legal name and any DBA?",
  },
  {
    id: "B02",
    section: " Business identity and organization",
    question:
      "What is its legal structure, formation date, and state of formation?",
  },
  {
    id: "B03",
    section: " Business identity and organization",
    question:
      "What is its tax identification number? Use the protected entry field.",
  },
  {
    id: "B04",
    section: " Business identity and organization",
    question:
      "Where does the business operate, and what is its mailing address?",
  },
  {
    id: "B05",
    section: " Business identity and organization",
    question: "What products or services does it sell?",
  },
  {
    id: "B06",
    section: " Business identity and organization",
    question:
      "What is the principal industry, and are there material secondary business activities?",
  },
  {
    id: "B07",
    section: " Business identity and organization",
    question: "When did operations begin, or when will they begin?",
  },
  {
    id: "B08",
    section: " Business identity and organization",
    question:
      "Who is the primary application contact and authorized business representative?",
  },
  {
    id: "B09",
    section: " Business identity and organization",
    question: "What is the business's phone number, email, and website?",
  },
  {
    id: "B10",
    section: " Business identity and organization",
    question:
      "What licenses, permits, registrations, or professional credentials are needed, and are they current?",
  },
  {
    id: "B11",
    section: " Business identity and organization",
    question:
      "How many employees are there, including the categories needed for applicable size evaluation?",
  },
  {
    id: "B12",
    section: " Business identity and organization",
    question:
      "What entities are co-borrowers, property owners, operating companies, or affiliates?",
  },
  {
    id: "B13",
    section: " Business identity and organization",
    question: "What are the business's average annual receipts for SBA size evaluation, including all applicable affiliates?",
  },
  {
    id: "B14",
    section: " Business identity and organization",
    question: "Explain the receipts calculation period, included affiliates, and supporting records. If pre-opening, explain whether the business or any affiliate has receipts.",
  },
  {
    id: "C01",
    section: " Owners, management, and related businesses",
    question:
      "Who owns the business, and what percentage does each person or entity own?",
  },
  {
    id: "C02",
    section: " Owners, management, and related businesses",
    question:
      "Will ownership change at closing? Provide the before-and-after ownership.",
  },
  {
    id: "C03",
    section: " Owners, management, and related businesses",
    question: "For every entity owner, who owns and controls that entity?",
  },
  {
    id: "C04",
    section: " Owners, management, and related businesses",
    question:
      "What are each relevant person's legal name, contact details, address, and role?",
  },
  {
    id: "C05",
    section: " Owners, management, and related businesses",
    question:
      "Who manages day-to-day operations and who can bind the business?",
  },
  {
    id: "C06",
    section: " Owners, management, and related businesses",
    question:
      "What relevant experience, qualifications, and management responsibilities does each key person have?",
  },
  {
    id: "C07",
    section: " Owners, management, and related businesses",
    question:
      "What other businesses do the owners own, manage, control, or guarantee?",
  },
  {
    id: "C08",
    section: " Owners, management, and related businesses",
    question:
      "Are there trusts, retirement plans, holding companies, or other indirect ownership arrangements?",
  },
  {
    id: "C09",
    section: " Owners, management, and related businesses",
    question:
      "What identifying and residency information is required by the applicable program and current forms? Collect it through the protected workflow.",
  },
  {
    id: "C10",
    section: " Owners, management, and related businesses",
    question:
      "Are any ownership interests pledged, disputed, subject to options, or expected to change?",
  },
  {
    id: "C11",
    section: " Owners, management, and related businesses",
    question:
      "What salary, draws, or distributions will each working owner receive?",
  },
  {
    id: "C12",
    section: " Owners, management, and related businesses",
    question:
      "Who will provide the requested guarantees, subject to the lender's final determination?",
  },
  {
    id: "D01",
    section: " Business story and operating plan",
    question:
      "How did the business start, and what important changes has it gone through?",
  },
  {
    id: "D02",
    section: " Business story and operating plan",
    question: "Who are its target customers, and what need does it meet?",
  },
  {
    id: "D03",
    section: " Business story and operating plan",
    question: "What makes customers choose this business?",
  },
  {
    id: "D04",
    section: " Business story and operating plan",
    question: "What are its main products or services and pricing?",
  },
  {
    id: "D05",
    section: " Business story and operating plan",
    question:
      "Where do sales come from: location, referrals, contracts, online, or other channels?",
  },
  {
    id: "D06",
    section: " Business story and operating plan",
    question: "How will the business attract and retain customers?",
  },
  {
    id: "D07",
    section: " Business story and operating plan",
    question:
      "Who are the main competitors, and how does the business compare?",
  },
  {
    id: "D08",
    section: " Business story and operating plan",
    question:
      "What are the largest customer concentrations and contract renewal risks?",
  },
  {
    id: "D09",
    section: " Business story and operating plan",
    question: "Who are the critical suppliers, and are alternatives available?",
  },
  {
    id: "D10",
    section: " Business story and operating plan",
    question:
      "What facilities, equipment, technology, and staffing support operations?",
  },
  {
    id: "D11",
    section: " Business story and operating plan",
    question:
      "Is revenue seasonal, and how does the business handle slow periods?",
  },
  {
    id: "D12",
    section: " Business story and operating plan",
    question:
      "What are the biggest risks, and how will management address them?",
  },
  {
    id: "E01",
    section: " Historical financial performance",
    question:
      "Which completed fiscal years have business tax returns available?",
  },
  {
    id: "E02",
    section: " Historical financial performance",
    question: "What is the fiscal year-end and accounting basis?",
  },
  {
    id: "E03",
    section: " Historical financial performance",
    question:
      "Can you provide the latest year-to-date profit and loss statement and balance sheet with their dates?",
  },
  {
    id: "E04",
    section: " Historical financial performance",
    question: "Can you provide the comparable prior-year period?",
  },
  {
    id: "E05",
    section: " Historical financial performance",
    question:
      "What explains material increases or decreases in sales, margins, or expenses?",
  },
  {
    id: "E06",
    section: " Historical financial performance",
    question:
      "Which expenses are claimed to be unusual or nonrecurring, and what evidence supports each claim?",
  },
  {
    id: "E07",
    section: " Historical financial performance",
    question:
      "What owner compensation, benefits, and distributions are included in the records?",
  },
  {
    id: "E08",
    section: " Historical financial performance",
    question:
      "Are there related-party rent, management fees, loans, or transfers?",
  },
  {
    id: "E09",
    section: " Historical financial performance",
    question:
      "What receivables, payables, or inventory reports are available, including aging or obsolete items?",
  },
  {
    id: "E10",
    section: " Historical financial performance",
    question:
      "Are taxes current, and are there payment plans, disputed assessments, or balances due?",
  },
  {
    id: "E11",
    section: " Historical financial performance",
    question:
      "Are there amended returns, restatements, or known differences between tax returns and financial statements?",
  },
  {
    id: "E12",
    section: " Historical financial performance",
    question:
      "What material financial changes have occurred since the latest statements?",
  },
  {
    id: "F01",
    section: " Existing business debts and obligations",
    question:
      "Does the business have any loans, credit lines, cards, leases, seller notes, merchant cash advances, factoring, or other financing?",
  },
  {
    id: "F02",
    section: " Existing business debts and obligations",
    question: "Who is the creditor and which entity is legally responsible?",
  },
  {
    id: "F03",
    section: " Existing business debts and obligations",
    question: "What were the original amount, origination date, and purpose?",
  },
  {
    id: "F04",
    section: " Existing business debts and obligations",
    question: "What is the current outstanding balance and balance date?",
  },
  {
    id: "F05",
    section: " Existing business debts and obligations",
    question:
      "What are the payment amount, frequency, interest rate, and rate adjustment terms?",
  },
  {
    id: "F06",
    section: " Existing business debts and obligations",
    question:
      "When does the obligation mature, and is there a balloon payment?",
  },
  {
    id: "F07",
    section: " Existing business debts and obligations",
    question: "What collateral, liens, and guarantees secure it?",
  },
  {
    id: "F08",
    section: " Existing business debts and obligations",
    question: "Is it current, modified, deferred, on standby, or in default?",
  },
  {
    id: "F09",
    section: " Existing business debts and obligations",
    question:
      "Will it remain, be paid off, or be refinanced with this project, and what payoff evidence is available?",
  },
  {
    id: "F10",
    section: " Existing business debts and obligations",
    question:
      "Are there unused commitments, contingent debts, lawsuits, or other obligations that could require payment?",
  },
  {
    id: "G01",
    section: " Equity contribution and source of funds",
    question: "How much will each contributor invest?",
  },
  {
    id: "G02",
    section: " Equity contribution and source of funds",
    question: "Who owns the funds, and in which accounts are they held?",
  },
  {
    id: "G03",
    section: " Equity contribution and source of funds",
    question:
      "Are the funds savings, gifts, asset-sale proceeds, borrowed money, retirement funds, or another source?",
  },
  {
    id: "G04",
    section: " Equity contribution and source of funds",
    question:
      "What statements and transaction records document the funds and their source?",
  },
  {
    id: "G05",
    section: " Equity contribution and source of funds",
    question:
      "Are any funds restricted, pledged, shared with someone else, or already committed?",
  },
  {
    id: "G06",
    section: " Equity contribution and source of funds",
    question:
      "For gifts or outside investment, what documentation and ownership or repayment terms apply?",
  },
  {
    id: "G07",
    section: " Equity contribution and source of funds",
    question:
      "For borrowed funds, what are the repayment terms and payment source?",
  },
  {
    id: "G08",
    section: " Equity contribution and source of funds",
    question:
      "How much liquidity will remain after the contribution and project expenses?",
  },
  {
    id: "G09",
    section: " Equity contribution and source of funds",
    question:
      "Are sellers providing financing, and what payment, subordination, or standby terms are proposed?",
  },
  {
    id: "G10",
    section: " Equity contribution and source of funds",
    question: "How will any cost overrun or funding shortfall be covered?",
  },
  {
    id: "H01",
    section: " Personal financial statements",
    question:
      "What is the financial statement's as-of date and whose financial position does it cover?",
  },
  {
    id: "H02",
    section: " Personal financial statements",
    question:
      "What cash and deposit accounts do you own, and what are their balances?",
  },
  {
    id: "H03",
    section: " Personal financial statements",
    question:
      "What investments and retirement accounts do you own, and are any restricted or pledged?",
  },
  {
    id: "H04",
    section: " Personal financial statements",
    question:
      "What real estate do you own, including ownership share, value, mortgages, payments, and rental income?",
  },
  {
    id: "H05",
    section: " Personal financial statements",
    question:
      "What interests in other businesses do you own, and how were their values estimated?",
  },
  {
    id: "H06",
    section: " Personal financial statements",
    question:
      "What notes or accounts are payable to you, and how collectible are they?",
  },
  {
    id: "H07",
    section: " Personal financial statements",
    question:
      "What vehicles, other personal assets, or insurance cash values belong on the applicable statement?",
  },
  {
    id: "H08",
    section: " Personal financial statements",
    question:
      "What personal loans, credit cards, mortgages, taxes, and other liabilities do you owe?",
  },
  {
    id: "H09",
    section: " Personal financial statements",
    question:
      "What guarantees, contingent obligations, legal claims, or other potential liabilities exist?",
  },
  {
    id: "H10",
    section: " Personal financial statements",
    question:
      "What are your salary, business income, investment income, rental income, and other applicable income sources?",
  },
  {
    id: "H11",
    section: " Personal financial statements",
    question:
      "What regular debt payments and other commitments affect available cash flow?",
  },
  {
    id: "H12",
    section: " Personal financial statements",
    question:
      "What returns, statements, schedules, and explanations support the financial statement?",
  },
  {
    id: "I01",
    section: " Acquisition of a business",
    question:
      "What business or ownership interest are you buying, and from whom?",
  },
  {
    id: "I02",
    section: " Acquisition of a business",
    question:
      "Is this an asset purchase, ownership purchase, or partial buyout?",
  },
  {
    id: "I03",
    section: " Acquisition of a business",
    question:
      "What is the purchase price and allocation among assets, inventory, goodwill, and other components?",
  },
  {
    id: "I04",
    section: " Acquisition of a business",
    question:
      "What signed agreement, letter of intent, amendments, and closing deadlines are available?",
  },
  {
    id: "I05",
    section: " Acquisition of a business",
    question:
      "Why is the seller selling, and is there any relationship between buyer and seller?",
  },
  {
    id: "I06",
    section: " Acquisition of a business",
    question:
      "What historical financial and tax information is available for the acquired operation?",
  },
  {
    id: "I07",
    section: " Acquisition of a business",
    question:
      "What liabilities, contracts, employees, licenses, and leases will transfer?",
  },
  {
    id: "I08",
    section: " Acquisition of a business",
    question:
      "What seller transition support, consulting, noncompetition, or continued ownership is proposed?",
  },
  {
    id: "I09",
    section: " Acquisition of a business",
    question:
      "Is there seller financing, an earnout, or another deferred payment?",
  },
  {
    id: "I10",
    section: " Acquisition of a business",
    question:
      "What changes will you make, and what evidence supports their projected impact?",
  },
  {
    id: "J01",
    section: " Real estate, construction, and equipment",
    question:
      "What property or equipment will be purchased, improved, built, or refinanced?",
  },
  {
    id: "J02",
    section: " Real estate, construction, and equipment",
    question: "Who will own it, and which business will use it?",
  },
  {
    id: "J03",
    section: " Real estate, construction, and equipment",
    question:
      "What purchase agreements, bids, quotes, plans, and budgets are available?",
  },
  {
    id: "J04",
    section: " Real estate, construction, and equipment",
    question:
      "How much of each property will the applicant occupy now and later, and who occupies the rest?",
  },
  {
    id: "J05",
    section: " Real estate, construction, and equipment",
    question:
      "What leases, rent rolls, renewal options, and landlord agreements apply?",
  },
  {
    id: "J06",
    section: " Real estate, construction, and equipment",
    question:
      "What existing liens, title issues, easements, or restrictions are known?",
  },
  {
    id: "J07",
    section: " Real estate, construction, and equipment",
    question:
      "What zoning, permitting, environmental, flood, condition, or access issues are known?",
  },
  {
    id: "J08",
    section: " Real estate, construction, and equipment",
    question:
      "For construction, who is the contractor and what are the schedule, contingency, and change-order arrangements?",
  },
  {
    id: "J09",
    section: " Real estate, construction, and equipment",
    question:
      "For equipment, what are the make, model, condition, price, useful-life expectations, and installation costs?",
  },
  {
    id: "J10",
    section: " Real estate, construction, and equipment",
    question:
      "What reports or third-party work are already available, and what still must be ordered by the lender?",
  },
  {
    id: "K01",
    section: " Franchise details",
    question: "What franchise brand and proposed location are involved?",
  },
  {
    id: "K02",
    section: " Franchise details",
    question:
      "Are you starting a new unit, acquiring one, or expanding an existing franchise business?",
  },
  {
    id: "K03",
    section: " Franchise details",
    question:
      "What disclosure documents, agreements, amendments, and approvals are available?",
  },
  {
    id: "K04",
    section: " Franchise details",
    question:
      "What initial fees, royalties, marketing charges, training costs, and required purchases apply?",
  },
  {
    id: "K05",
    section: " Franchise details",
    question:
      "What territory rights, operating restrictions, and renewal or transfer terms apply?",
  },
  {
    id: "K06",
    section: " Franchise details",
    question: "What support and training will the franchisor provide?",
  },
  {
    id: "K07",
    section: " Franchise details",
    question:
      "What evidence supports the startup budget and revenue assumptions?",
  },
  {
    id: "K08",
    section: " Franchise details",
    question:
      "Are there required renovations, opening deadlines, or performance obligations?",
  },
  {
    id: "L01",
    section: " Projections and assumptions",
    question: "What is the anticipated funding, opening, or acquisition date?",
  },
  {
    id: "L02",
    section: " Projections and assumptions",
    question:
      "What products or services will generate revenue in each projection period?",
  },
  {
    id: "L03",
    section: " Projections and assumptions",
    question:
      "What volumes, prices, customer counts, contracts, and ramp-up assumptions support that revenue?",
  },
  {
    id: "L04",
    section: " Projections and assumptions",
    question: "What seasonality and capacity limits apply?",
  },
  {
    id: "L05",
    section: " Projections and assumptions",
    question:
      "What direct costs and gross margin assumptions apply by revenue stream?",
  },
  {
    id: "L06",
    section: " Projections and assumptions",
    question:
      "What staffing, compensation, benefits, and hiring dates are planned?",
  },
  {
    id: "L07",
    section: " Projections and assumptions",
    question:
      "What rent, utilities, insurance, marketing, technology, and other operating expenses are planned?",
  },
  {
    id: "L08",
    section: " Projections and assumptions",
    question:
      "What owner compensation, distributions, and personal support needs must the plan reflect?",
  },
  {
    id: "L09",
    section: " Projections and assumptions",
    question:
      "What inventory, receivable collection, and payable payment assumptions affect working capital?",
  },
  {
    id: "L10",
    section: " Projections and assumptions",
    question:
      "What startup costs, capital spending, replacements, and contingencies are planned?",
  },
  {
    id: "L11",
    section: " Projections and assumptions",
    question:
      "What existing and proposed debt payments and financing terms should be included?",
  },
  {
    id: "L12",
    section: " Projections and assumptions",
    question:
      "What evidence supports each major assumption, and which are estimates?",
  },
  {
    id: "L13",
    section: " Projections and assumptions",
    question:
      "What happens if sales start later, revenue is lower, or costs are higher?",
  },
  {
    id: "L14",
    section: " Projections and assumptions",
    question: "How will the business fund a projected cash shortfall?",
  },
  {
    id: "M01",
    section: " Required disclosures and explanations",
    question:
      "What current or previous government financing involves the applicant and relevant parties?",
  },
  {
    id: "M02",
    section: " Required disclosures and explanations",
    question:
      "Are there defaults, losses, delinquencies, compromises, or other reportable issues on that financing?",
  },
  {
    id: "M03",
    section: " Required disclosures and explanations",
    question:
      "Are there bankruptcies, insolvency proceedings, judgments, liens, or material legal proceedings that the applicable forms or lender require disclosed?",
  },
  {
    id: "M04",
    section: " Required disclosures and explanations",
    question:
      "Are there suspensions, exclusions, debarments, or other applicable eligibility disclosures?",
  },
  {
    id: "M05",
    section: " Required disclosures and explanations",
    question:
      "What current form-specific individual background questions apply, and what explanations or documents are required?",
  },
  {
    id: "M06",
    section: " Required disclosures and explanations",
    question:
      "Are there relationships or conflicts involving participating lenders, intermediaries, or government personnel that require disclosure?",
  },
  {
    id: "M07",
    section: " Required disclosures and explanations",
    question:
      "Has this project been submitted elsewhere, and what was the result?",
  },
  {
    id: "M08",
    section: " Required disclosures and explanations",
    question:
      "Who is being paid to help obtain this financing, what services are provided, and what fees or agreements apply?",
  },
  {
    id: "M09",
    section: " Required disclosures and explanations",
    question:
      "What other current program or lender questions apply to this business's activities and ownership?",
  },
  {
    id: "M10",
    section: " Required disclosures and explanations",
    question: "Who can review and certify each required disclosure?",
  },
  {
    id: "N01",
    section: " Supporting evidence",
    question:
      "Which requested tax returns are available for each business and required person, including all requested schedules?",
  },
  {
    id: "N02",
    section: " Supporting evidence",
    question:
      "Which interim financial statements and supporting financial schedules are available?",
  },
  {
    id: "N03",
    section: " Supporting evidence",
    question:
      "Which formation, ownership, affiliate, and authorization documents are available?",
  },
  {
    id: "N04",
    section: " Supporting evidence",
    question:
      "Which debt statements, agreements, and payoff letters are available?",
  },
  {
    id: "N05",
    section: " Supporting evidence",
    question:
      "Which contribution-source statements and transaction records are available?",
  },
  {
    id: "N06",
    section: " Supporting evidence",
    question:
      "Which transaction contracts, leases, franchise materials, quotes, and permits are available?",
  },
  {
    id: "N07",
    section: " Supporting evidence",
    question:
      "Which resumes, business plans, projections, and assumption support are available?",
  },
  {
    id: "N08",
    section: " Supporting evidence",
    question:
      "Which identity, personal financial, and other protected documents remain to be supplied?",
  },
  {
    id: "N09",
    section: " Supporting evidence",
    question:
      "Is any requested document unavailable, and who can provide it or an acceptable alternative?",
  },
  {
    id: "N10",
    section: " Supporting evidence",
    question:
      "Do all submitted documents cover the correct entity, person, period, and version, with all pages included?",
  },
  {
    id: "O01",
    section: " Review, consent, and package handoff",
    question:
      "Does the application summary accurately describe the business, owners, request, and use of funds?",
  },
  {
    id: "O02",
    section: " Review, consent, and package handoff",
    question:
      "Are the financial information, debt schedule, and contribution sources correct?",
  },
  {
    id: "O03",
    section: " Review, consent, and package handoff",
    question:
      "Are the business narrative and projection assumptions accurate, with estimates clearly identified?",
  },
  {
    id: "O04",
    section: " Review, consent, and package handoff",
    question:
      "Have conflicting answers and document discrepancies been resolved?",
  },
  {
    id: "O05",
    section: " Review, consent, and package handoff",
    question:
      "Have you reviewed each applicable form and its exact certifications?",
  },
  {
    id: "O06",
    section: " Review, consent, and package handoff",
    question:
      "Has every required person completed their own outstanding actions, identity steps, and signatures?",
  },
  {
    id: "O07",
    section: " Review, consent, and package handoff",
    question:
      "What lender-specific requirements remain, and who owns each next action?",
  },
  {
    id: "O08",
    section: " Review, consent, and package handoff",
    question:
      "Do you authorize the specific submission or sharing action shown, with the recipient and package identified?",
  },
] as const;
