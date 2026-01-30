/**
 * UUID v7 generator.
 *
 * UUID v7 layout (RFC 9562):
 *   48 bits  — Unix timestamp in milliseconds
 *    4 bits  — version (0111 = 7)
 *   12 bits  — random
 *    2 bits  — variant (10)
 *   62 bits  — random
 *
 * Total: 128 bits
 * Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 *
 * Properties:
 *   - Monotonically increasing (time-ordered)
 *   - Globally unique
 *   - K-sortable by creation time
 */

import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const now = Date.now();

  // 6 bytes for 48-bit timestamp (ms since epoch)
  const ts = Buffer.alloc(6);
  ts.writeUIntBE(now, 0, 6);

  // 10 bytes of random data
  const rand = randomBytes(10);

  // Assemble 16-byte UUID
  const bytes = Buffer.alloc(16);

  // Bytes 0-5: timestamp
  ts.copy(bytes, 0);

  // Bytes 6-7: version (4 bits) + 12 bits random
  bytes[6] = (0x70 | (rand[0] & 0x0f)); // version 7
  bytes[7] = rand[1];

  // Bytes 8-9: variant (2 bits) + 14 bits random
  bytes[8] = (0x80 | (rand[2] & 0x3f)); // variant 10xx
  bytes[9] = rand[3];

  // Bytes 10-15: 48 bits random
  rand.copy(bytes, 10, 4, 10);

  // Format as UUID string
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
