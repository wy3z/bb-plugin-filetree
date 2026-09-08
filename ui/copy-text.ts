import { toast } from "sonner";

export async function copyText(
  text: string,
  kind: "path" | "contents",
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(
      kind === "path" ? "File path copied" : "File contents copied",
    );
  } catch {
    toast.error(
      kind === "path"
        ? "Failed to copy file path"
        : "Failed to copy file contents",
    );
  }
}
