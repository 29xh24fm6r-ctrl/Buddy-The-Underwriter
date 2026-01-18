export type Variant = "A" | "B";

let activeVariant: Variant = "A";

export function setVoiceVariant(v: Variant) {
  activeVariant = v;
}

export function getVoiceVariant(): Variant {
  return activeVariant;
}

export function variantPick<T>(a: T, b: T): T {
  return activeVariant === "A" ? a : b;
}
