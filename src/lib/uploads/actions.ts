"use server";

import { markUploadsCompleted } from "@/lib/uploads/commitUploadedFile";

/**
 * Shared server actions for upload operations.
 * Allows client components to trigger server-only logic without violating boundaries.
 */

export async function markUploadsCompletedAction(dealId: string, bankId: string) {
  return markUploadsCompleted(dealId, bankId);
}
