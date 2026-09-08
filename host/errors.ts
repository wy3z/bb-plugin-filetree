export type NativeFileHostErrorCode =
  | "native_file_binding_unknown"
  | "native_file_confinement_unavailable"
  | "native_file_invalid_path"
  | "native_file_not_found"
  | "native_file_operation_cancelled"
  | "native_file_too_large";
export class NativeFileHostError extends Error {
  constructor(
    readonly code: NativeFileHostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NativeFileHostError";
  }
}
export function remapFilesystemError(error: unknown): never {
  if (error instanceof NativeFileHostError) throw error;
  if (error instanceof Error && "code" in error) {
    const code = String(error.code);
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new NativeFileHostError(
        "native_file_not_found",
        "File or directory not found",
      );
    }
    if (code === "ELOOP" || code === "EMLINK") {
      throw new NativeFileHostError(
        "native_file_invalid_path",
        "Symbolic links are not available through Native Files",
      );
    }
    if (code === "EINVAL") {
      throw new NativeFileHostError(
        "native_file_invalid_path",
        "Path must be a normalized relative path",
      );
    }
    if (code === "ENOSYS" || code === "ENOTSUP") {
      throw new NativeFileHostError(
        "native_file_confinement_unavailable",
        "Native Files confinement is unavailable on this host",
      );
    }
  }
  throw error;
}
