// src/app/(app)/deals/new/actions.ts
"use server";

import { markUploadsCompletedAction as _markUploadsCompletedAction } from "@/lib/uploads/actions";

export async function markUploadsCompletedAction(
  ...args: Parameters<typeof _markUploadsCompletedAction>
) {
  return _markUploadsCompletedAction(...args);
}
