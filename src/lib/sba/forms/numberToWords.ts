/**
 * Spells out a dollar amount for legal documents that require it in
 * words (SBA Forms 148/148L both ask for the note's principal amount "IN
 * WORDS" alongside the numeral, check-writing convention:
 * "One Hundred Thousand and 00/100"). No "Dollars" suffix — the printed
 * form already has the word "Dollars" following the blank.
 */

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (remainder > 0) {
    if (remainder < 20) {
      parts.push(ONES[remainder]);
    } else {
      const tens = Math.floor(remainder / 10);
      const ones = remainder % 10;
      parts.push(ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]);
    }
  }
  return parts.join(" ");
}

/** Integer part only, e.g. 1234567 -> "One Million, Two Hundred Thirty-Four Thousand, Five Hundred Sixty-Seven". Zero -> "Zero". */
export function integerToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const groups: number[] = [];
  let remaining = n;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  if (groups.length > SCALES.length) {
    throw new Error(`numberToWords: ${value} is too large to spell out`);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const words = threeDigitsToWords(groups[i]);
    parts.push(SCALES[i] ? `${words} ${SCALES[i]}` : words);
  }
  return parts.join(", ");
}

/** Full check-writing form: 100000 -> "One Hundred Thousand and 00/100"; 1234.5 -> "One Thousand, Two Hundred Thirty-Four and 50/100". */
export function amountToWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const dollars = Math.floor(rounded);
  const cents = Math.round((rounded - dollars) * 100);
  return `${integerToWords(dollars)} and ${String(cents).padStart(2, "0")}/100`;
}
