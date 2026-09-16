const US_PHONE_LENGTH = 10;

export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  const withoutCountryCode =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  return withoutCountryCode.slice(0, US_PHONE_LENGTH);
}

export function formatUsPhoneInput(value: string): string {
  const digits = phoneDigits(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatUsdInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(digits));
}

export function parseUsdInput(value: string): number | undefined {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : undefined;
}
