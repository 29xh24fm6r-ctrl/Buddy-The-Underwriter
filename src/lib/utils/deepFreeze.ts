/**
 * Deep Freeze — recursively freezes an object and all nested objects/arrays.
 * Returns the same reference, now deeply immutable.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (val !== null && val !== undefined && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}
