import type { GuidedQuestion } from "../guidedPackage/questions";

/** All package prompts retain a destination. Activity completion is not loan approval. */
export const FACTORY_ACTIVITIES = [
  {
    "id": 1,
    "title": "Your project brief",
    "chapter": "plan",
    "questionIds": [
      "A01",
      "A02",
      "A11",
      "A12",
      "A15",
      "K01",
      "K02"
    ]
  },
  {
    "id": 2,
    "title": "Your site and timeline",
    "chapter": "plan",
    "questionIds": [
      "A07",
      "B07",
      "L01"
    ]
  },
  {
    "id": 3,
    "title": "Your project budget",
    "chapter": "plan",
    "questionIds": [
      "A03",
      "A04",
      "A05",
      "A06",
      "A09",
      "I03",
      "L10"
    ]
  },
  {
    "id": 4,
    "title": "Your company card",
    "chapter": "business",
    "questionIds": [
      "A08",
      "B01",
      "B02",
      "B04",
      "B09",
      "B12",
      "B13",
      "B14"
    ]
  },
  {
    "id": 5,
    "title": "Your ownership and team",
    "chapter": "business",
    "questionIds": [
      "B08",
      "B11",
      "C01",
      "C02",
      "C03",
      "C04",
      "C05",
      "C06",
      "C07",
      "C08",
      "C10",
      "C12"
    ]
  },
  {
    "id": 6,
    "title": "Your business story",
    "chapter": "business",
    "questionIds": [
      "B05",
      "B06",
      "D01",
      "D02",
      "D03",
      "D04",
      "D05",
      "D06",
      "D07"
    ]
  },
  {
    "id": 7,
    "title": "Your operating plan",
    "chapter": "business",
    "questionIds": [
      "B10",
      "D08",
      "D09",
      "D10",
      "D12"
    ]
  },
  {
    "id": 8,
    "title": "Your franchise plan",
    "chapter": "business",
    "questionIds": [
      "K04",
      "K05",
      "K06",
      "K08"
    ]
  },
  {
    "id": 9,
    "title": "Your purchase plan",
    "chapter": "plan",
    "questionIds": [
      "I01",
      "I02",
      "I05",
      "I07",
      "I08"
    ]
  },
  {
    "id": 10,
    "title": "Your site and equipment plan",
    "chapter": "plan",
    "questionIds": [
      "A14",
      "J01",
      "J02",
      "J04",
      "J05",
      "J06",
      "J07",
      "J08",
      "J09"
    ]
  },
  {
    "id": 11,
    "title": "Your financial history",
    "chapter": "numbers",
    "questionIds": [
      "E02",
      "E05",
      "E06",
      "E07",
      "E08",
      "E12"
    ]
  },
  {
    "id": 12,
    "title": "Your debt picture",
    "chapter": "numbers",
    "questionIds": [
      "F01",
      "F02",
      "F03",
      "F04",
      "F05",
      "F06",
      "F07",
      "F08",
      "F09",
      "F10",
      "G09",
      "I09",
      "L11"
    ]
  },
  {
    "id": 13,
    "title": "Your contribution plan",
    "chapter": "numbers",
    "questionIds": [
      "G01",
      "G02",
      "G03",
      "G05",
      "G06",
      "G07",
      "G08"
    ]
  },
  {
    "id": 14,
    "title": "Your personal financial picture",
    "chapter": "numbers",
    "questionIds": [
      "H01",
      "H02",
      "H03",
      "H04",
      "H05",
      "H06",
      "H07",
      "H08",
      "H09",
      "H10",
      "H11"
    ]
  },
  {
    "id": 15,
    "title": "Your business forecast",
    "chapter": "application",
    "questionIds": [
      "C11",
      "D11",
      "I10",
      "K07",
      "L02",
      "L03",
      "L04",
      "L05",
      "L06",
      "L07",
      "L08",
      "L09",
      "L12"
    ]
  },
  {
    "id": 16,
    "title": "Your backup plan",
    "chapter": "application",
    "questionIds": [
      "G10",
      "L13",
      "L14"
    ]
  },
  {
    "id": 17,
    "title": "Your document desk",
    "chapter": "numbers",
    "questionIds": [
      "E01",
      "E03",
      "E04",
      "E09",
      "G04",
      "H12",
      "I04",
      "I06",
      "J03",
      "K03",
      "N01",
      "N02",
      "N03",
      "N04",
      "N05",
      "N06",
      "N07",
      "N09",
      "N10"
    ]
  },
  {
    "id": 18,
    "title": "Your private details",
    "chapter": "business",
    "questionIds": [
      "B03",
      "C09",
      "N08"
    ]
  },
  {
    "id": 19,
    "title": "Your required disclosures",
    "chapter": "review",
    "questionIds": [
      "E10",
      "M01",
      "M02",
      "M03",
      "M04",
      "M05",
      "M06",
      "M09"
    ]
  },
  {
    "id": 20,
    "title": "Your financing route and helpers",
    "chapter": "application",
    "questionIds": [
      "A10",
      "A13",
      "M07",
      "M08"
    ]
  },
  {
    "id": 21,
    "title": "Review your plan and numbers",
    "chapter": "application",
    "questionIds": [
      "O01",
      "O02",
      "O03"
    ]
  },
  {
    "id": 22,
    "title": "Resolve differences",
    "chapter": "review",
    "questionIds": [
      "E11",
      "O04"
    ]
  },
  {
    "id": 23,
    "title": "Review forms and sign",
    "chapter": "review",
    "questionIds": [
      "M10",
      "O05",
      "O06"
    ]
  },
  {
    "id": 24,
    "title": "Your package handoff",
    "chapter": "review",
    "questionIds": [
      "J10",
      "O07",
      "O08"
    ]
  }
] as const;

export const QUESTION_TREATMENTS: Record<string, string> = {
  "A01": "Reuse",
  "A02": "Merge",
  "A03": "Reuse",
  "A04": "Merge",
  "A05": "Merge",
  "A06": "Conditional",
  "A07": "Merge",
  "A08": "Merge",
  "A09": "Merge",
  "A10": "Conditional",
  "A11": "Reuse",
  "A12": "Reuse",
  "A13": "Conditional",
  "A14": "Conditional",
  "A15": "Conditional",
  "B01": "Review",
  "B02": "Review",
  "B03": "Keep",
  "B04": "Merge",
  "B05": "Merge",
  "B06": "Reuse",
  "B07": "Merge",
  "B08": "Merge",
  "B09": "Reuse",
  "B10": "Conditional",
  "B11": "Merge",
  "B12": "Merge",
  "B13": "Keep",
  "B14": "Review",
  "C01": "Keep",
  "C02": "Conditional",
  "C03": "Conditional",
  "C04": "Merge",
  "C05": "Merge",
  "C06": "Review",
  "C07": "Merge",
  "C08": "Conditional",
  "C09": "Keep",
  "C10": "Conditional",
  "C11": "Merge",
  "C12": "Conditional",
  "D01": "Conditional",
  "D02": "Merge",
  "D03": "Merge",
  "D04": "Merge",
  "D05": "Merge",
  "D06": "Merge",
  "D07": "Conditional",
  "D08": "Conditional",
  "D09": "Merge",
  "D10": "Reuse",
  "D11": "Merge",
  "D12": "Merge",
  "E01": "Review",
  "E02": "Review",
  "E03": "Review",
  "E04": "Conditional",
  "E05": "Conditional",
  "E06": "Conditional",
  "E07": "Review",
  "E08": "Conditional",
  "E09": "Conditional",
  "E10": "Keep",
  "E11": "Conditional",
  "E12": "Keep",
  "F01": "Keep",
  "F02": "Review",
  "F03": "Review",
  "F04": "Review",
  "F05": "Review",
  "F06": "Review",
  "F07": "Review",
  "F08": "Keep",
  "F09": "Merge",
  "F10": "Keep",
  "G01": "Merge",
  "G02": "Review",
  "G03": "Merge",
  "G04": "Review",
  "G05": "Keep",
  "G06": "Conditional",
  "G07": "Conditional",
  "G08": "Merge",
  "G09": "Merge",
  "G10": "Merge",
  "H01": "Keep",
  "H02": "Review",
  "H03": "Review",
  "H04": "Review",
  "H05": "Reuse",
  "H06": "Conditional",
  "H07": "Conditional",
  "H08": "Review",
  "H09": "Keep",
  "H10": "Review",
  "H11": "Merge",
  "H12": "Review",
  "I01": "Merge",
  "I02": "Review",
  "I03": "Review",
  "I04": "Review",
  "I05": "Keep",
  "I06": "Review",
  "I07": "Review",
  "I08": "Review",
  "I09": "Merge",
  "I10": "Merge",
  "J01": "Merge",
  "J02": "Reuse",
  "J03": "Review",
  "J04": "Keep",
  "J05": "Review",
  "J06": "Keep",
  "J07": "Keep",
  "J08": "Conditional",
  "J09": "Review",
  "J10": "Conditional",
  "K01": "Reuse",
  "K02": "Merge",
  "K03": "Review",
  "K04": "Review",
  "K05": "Review",
  "K06": "Review",
  "K07": "Review",
  "K08": "Review",
  "L01": "Reuse",
  "L02": "Reuse",
  "L03": "Merge",
  "L04": "Merge",
  "L05": "Merge",
  "L06": "Merge",
  "L07": "Merge",
  "L08": "Reuse",
  "L09": "Merge",
  "L10": "Reuse",
  "L11": "Reuse",
  "L12": "Merge",
  "L13": "Keep",
  "L14": "Merge",
  "M01": "Keep",
  "M02": "Keep",
  "M03": "Keep",
  "M04": "Keep",
  "M05": "Reuse",
  "M06": "Keep",
  "M07": "Merge",
  "M08": "Conditional",
  "M09": "Reuse",
  "M10": "Reuse",
  "N01": "Review",
  "N02": "Review",
  "N03": "Review",
  "N04": "Review",
  "N05": "Review",
  "N06": "Review",
  "N07": "Review",
  "N08": "Review",
  "N09": "Conditional",
  "N10": "Review",
  "O01": "Merge",
  "O02": "Merge",
  "O03": "Merge",
  "O04": "Conditional",
  "O05": "Keep",
  "O06": "Reuse",
  "O07": "Reuse",
  "O08": "Keep"
};

export function factoryActivityFor(q: GuidedQuestion) {
  const narrative = FACTORY_ACTIVITIES.find(a => (a.questionIds as readonly string[]).includes(q.id));
  if (narrative) return narrative;
  const path = q.field?.registryEntry.factPath ?? q.id;
  const id = q.field?.requiresPiiVault ? 18
    : q.field?.requiresExplicitConfirmation ? 19
    : /use_of_proceeds|amount_requested/.test(path) ? 3
    : /sba_program|agent|fees/.test(path) ? 20
    : /personal|financial|assets|liabilities/.test(path) ? 14
    : q.ownerId ? 5 : 4;
  return FACTORY_ACTIVITIES.find(a => a.id === id)!;
}

/** Private values, legal confirmations and specialized editors never enter a bulk save. */
export function canGroupQuestion(q: GuidedQuestion) {
  return q.responsibility === "borrower" && q.state !== "not_applicable" &&
    !q.field?.requiresPiiVault && !q.field?.requiresExplicitConfirmation &&
    !["loan.use_of_proceeds", "loan.sba_program"].includes(q.id);
}

