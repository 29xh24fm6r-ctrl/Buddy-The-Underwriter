export class UploadCommitError extends Error {
  readonly uploadDurable: boolean;

  constructor(message: string, uploadDurable: boolean) {
    super(message);
    this.name = "UploadCommitError";
    this.uploadDurable = uploadDurable;
  }
}

export function isUploadCommitError(error: unknown): error is UploadCommitError {
  return (
    error instanceof UploadCommitError ||
    (Boolean(error) &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "UploadCommitError" &&
      typeof (error as { uploadDurable?: unknown }).uploadDurable === "boolean")
  );
}
