/**
 * JSON Serialization Safety Utilities
 *
 * Ensures payloads are safe for JSON.stringify/Response.json without throwing.
 * Common hidden 500 sources:
 * - BigInt (throws "BigInt can't be serialized")
 * - Circular references
 * - Error objects (serialize to {})
 * - undefined in arrays
 * - Symbol keys
 */

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_DEPTH = 10;

/**
 * Sanitize a value to be JSON-safe.
 * - BigInt → string
 * - Error → { name, message }
 * - undefined → null (in arrays) or omitted (in objects)
 * - Circular references → "[Circular]"
 * - Long strings → truncated
 * - Deep nesting → "[MaxDepth]"
 */
export function jsonSafe<T>(value: T, seen = new WeakSet(), depth = 0): T {
  // Prevent infinite recursion
  if (depth > MAX_OBJECT_DEPTH) {
    return "[MaxDepth]" as T;
  }

  // Primitives
  if (value === null || value === undefined) {
    return null as T;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    // Handle NaN and Infinity
    if (typeof value === "number" && !Number.isFinite(value)) {
      return null as T;
    }
    return value;
  }

  if (typeof value === "string") {
    // Truncate long strings
    if (value.length > MAX_STRING_LENGTH) {
      return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` as T;
    }
    return value;
  }

  if (typeof value === "bigint") {
    // BigInt cannot be serialized - convert to string
    return value.toString() as T;
  }

  if (typeof value === "symbol") {
    return value.toString() as T;
  }

  if (typeof value === "function") {
    return "[Function]" as T;
  }

  // Error objects
  if (value instanceof Error) {
    return {
      name: value.name,
      message: jsonSafe(value.message, seen, depth + 1),
      ...(value.stack ? { stack: jsonSafe(value.stack.slice(0, 500), seen, depth + 1) } : {}),
    } as T;
  }

  // Date objects
  if (value instanceof Date) {
    return value.toISOString() as T;
  }

  // Arrays
  if (Array.isArray(value)) {
    // Check for circular reference
    if (seen.has(value)) {
      return "[Circular]" as T;
    }
    seen.add(value);

    // Truncate long arrays
    const arr = value.length > MAX_ARRAY_LENGTH ? value.slice(0, MAX_ARRAY_LENGTH) : value;
    const result = arr.map((item) => jsonSafe(item, seen, depth + 1));

    if (value.length > MAX_ARRAY_LENGTH) {
      result.push(`...[${value.length - MAX_ARRAY_LENGTH} more items]`);
    }

    return result as T;
  }

  // Objects
  if (typeof value === "object") {
    // Check for circular reference
    if (seen.has(value)) {
      return "[Circular]" as T;
    }
    seen.add(value);

    // Handle special objects that don't serialize well
    const proto = Object.prototype.toString.call(value);
    if (proto === "[object Map]") {
      return Object.fromEntries(
        Array.from((value as unknown as Map<unknown, unknown>).entries()).map(([k, v]) => [
          String(k),
          jsonSafe(v, seen, depth + 1),
        ])
      ) as T;
    }
    if (proto === "[object Set]") {
      return jsonSafe(Array.from(value as unknown as Set<unknown>), seen, depth + 1) as T;
    }

    // Regular object
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Skip symbol keys and undefined values
      if (typeof key === "symbol") continue;
      if (val === undefined) continue;
      result[key] = jsonSafe(val, seen, depth + 1);
    }
    return result as T;
  }

  // Fallback - stringify anything else
  try {
    return String(value) as T;
  } catch {
    return "[Unserializable]" as T;
  }
}

/**
 * Safely stringify with fallback.
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(jsonSafe(value));
  } catch (e) {
    return JSON.stringify({ error: "Failed to serialize", type: typeof value });
  }
}

/**
 * Sanitize error for logging/evidence.
 * Returns a simple object safe for JSON serialization.
 */
export function sanitizeErrorForEvidence(err: unknown): {
  type: string;
  message: string;
  name?: string;
} {
  if (err instanceof Error) {
    return {
      type: "Error",
      name: err.name,
      message: err.message.slice(0, 500),
    };
  }
  if (typeof err === "string") {
    return {
      type: "string",
      message: err.slice(0, 500),
    };
  }
  if (typeof err === "object" && err !== null) {
    try {
      return {
        type: "object",
        message: JSON.stringify(err).slice(0, 500),
      };
    } catch {
      return {
        type: "object",
        message: "[Could not serialize]",
      };
    }
  }
  return {
    type: typeof err,
    message: String(err).slice(0, 500),
  };
}
