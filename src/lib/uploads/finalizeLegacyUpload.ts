import { isUploadCommitError } from "./uploadCommitError";

export type LegacyUploadFinalizeResult<T> =
  | { status: "committed"; commit: T }
  | { status: "processing_pending"; error: string }
  | { status: "rolled_back"; error: string }
  | { status: "cleanup_failed"; error: string; cleanupError: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Converges the legacy server-upload boundary without deleting user bytes that
 * already have durable database provenance.
 *
 * Only a typed pre-commit failure is eligible for compensating deletion. A
 * durable or unknown failure keeps the object for retry/reconciliation.
 */
export async function finalizeLegacyUpload<T>(args: {
  commit: () => Promise<T>;
  removeUncommittedObject: () => Promise<void>;
}): Promise<LegacyUploadFinalizeResult<T>> {
  try {
    return { status: "committed", commit: await args.commit() };
  } catch (error) {
    const message = errorMessage(error);

    if (!isUploadCommitError(error) || error.uploadDurable) {
      return { status: "processing_pending", error: message };
    }

    try {
      await args.removeUncommittedObject();
      return { status: "rolled_back", error: message };
    } catch (cleanupError) {
      return {
        status: "cleanup_failed",
        error: message,
        cleanupError: errorMessage(cleanupError),
      };
    }
  }
}
