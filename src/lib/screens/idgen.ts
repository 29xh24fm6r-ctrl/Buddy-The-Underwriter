import "server-only";

/**
 * Generate a URL-safe public ID for screen artifacts.
 * Using simple nanoid-style implementation.
 */
export function generateScreenId(): string {
  // Simple 12-char random string using crypto
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  
  let id = "";
  for (let i = 0; i < bytes.length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  
  return id;
}

/**
 * Validate screen ID format (lowercase alphanumeric, 12 chars)
 */
export function isValidScreenId(id: string): boolean {
  return /^[a-z0-9]{12}$/.test(id);
}
