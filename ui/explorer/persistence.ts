import { NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH } from "../../contracts/model";
import {
  NATIVE_FILES_CLIENT_STATE_MAX_AGE_MS,
  NATIVE_FILES_STATE_MAX_BYTES,
  NATIVE_FILES_STATE_MAX_EXPANDED_PATHS,
  NATIVE_FILES_CLIENT_STATE_VERSION,
  nativeFilesPersistedRootChoiceSchema,
  nativeFilesPersistedRootStateSchema,
  type NativeFilesPersistedRootState,
} from "../native-files-ui-types.js";
const ROOT_CHOICE_PREFIX = "bb-plugin-files:root-choice:v1:";
const ROOT_STATE_PREFIX = "bb-plugin-files:root-state:v1:";
export function rootChoiceKey(threadId: string): string {
  return `${ROOT_CHOICE_PREFIX}${threadId}`;
}
export function rootStateKey(threadId: string, rootId: string): string {
  return `${ROOT_STATE_PREFIX}${threadId}:${rootId}`;
}
export function validRelativePath(path: string, allowEmpty: boolean): boolean {
  if (path === "") return allowEmpty;
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
function readRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {}
}
function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {}
}
export function readPersistedRootChoice(
  storage: Storage,
  threadId: string,
  nowMs: number = Date.now(),
): string | null {
  const key = rootChoiceKey(threadId);
  const raw = readRaw(storage, key);
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).byteLength > NATIVE_FILES_STATE_MAX_BYTES) {
    remove(storage, key);
    return null;
  }
  try {
    const parsed = nativeFilesPersistedRootChoiceSchema.parse(JSON.parse(raw));
    if (
      parsed.threadId !== threadId ||
      parsed.savedAtMs > nowMs ||
      nowMs - parsed.savedAtMs > NATIVE_FILES_CLIENT_STATE_MAX_AGE_MS
    ) {
      remove(storage, key);
      return null;
    }
    return parsed.rootId;
  } catch {
    remove(storage, key);
    return null;
  }
}
export function writePersistedRootChoice(
  storage: Storage,
  threadId: string,
  rootId: string,
  nowMs: number = Date.now(),
): void {
  write(
    storage,
    rootChoiceKey(threadId),
    JSON.stringify({
      version: NATIVE_FILES_CLIENT_STATE_VERSION,
      savedAtMs: nowMs,
      threadId,
      rootId,
    }),
  );
}
export function clearPersistedRootChoice(
  storage: Storage,
  threadId: string,
): void {
  remove(storage, rootChoiceKey(threadId));
}
export function readPersistedRootState(
  storage: Storage,
  threadId: string,
  rootId: string,
  nowMs: number = Date.now(),
): NativeFilesPersistedRootState | null {
  const key = rootStateKey(threadId, rootId);
  const raw = readRaw(storage, key);
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).byteLength > NATIVE_FILES_STATE_MAX_BYTES) {
    remove(storage, key);
    return null;
  }
  try {
    const parsed = nativeFilesPersistedRootStateSchema.parse(JSON.parse(raw));
    const paths = parsed.expandedPaths;
    if (
      parsed.threadId !== threadId ||
      parsed.rootId !== rootId ||
      parsed.savedAtMs > nowMs ||
      nowMs - parsed.savedAtMs > NATIVE_FILES_CLIENT_STATE_MAX_AGE_MS ||
      new Set(paths).size !== paths.length ||
      paths.some((path) => !validRelativePath(path, false)) ||
      (parsed.selectedPath !== null &&
        !validRelativePath(parsed.selectedPath, false))
    ) {
      remove(storage, key);
      return null;
    }
    return parsed;
  } catch {
    remove(storage, key);
    return null;
  }
}
export function writePersistedRootState(
  storage: Storage,
  state: Omit<NativeFilesPersistedRootState, "version" | "savedAtMs">,
  nowMs: number = Date.now(),
): void {
  const key = rootStateKey(state.threadId, state.rootId);
  const expandedPaths = [...new Set(state.expandedPaths)]
    .filter((path) => validRelativePath(path, false))
    .slice(0, NATIVE_FILES_STATE_MAX_EXPANDED_PATHS);
  const parsed = nativeFilesPersistedRootStateSchema.safeParse({
    ...state,
    version: NATIVE_FILES_CLIENT_STATE_VERSION,
    savedAtMs: nowMs,
    expandedPaths,
    searchQuery: state.searchQuery.slice(
      0,
      NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH,
    ),
  });
  if (
    !parsed.success ||
    (parsed.data.selectedPath !== null &&
      !validRelativePath(parsed.data.selectedPath, false))
  )
    return;
  const encode = (paths: readonly string[]) =>
    JSON.stringify({ ...parsed.data, expandedPaths: paths });
  let low = 0;
  let high = expandedPaths.length;
  let value: string | null = null;
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = encode(expandedPaths.slice(0, midpoint));
    if (
      new TextEncoder().encode(candidate).byteLength <=
      NATIVE_FILES_STATE_MAX_BYTES
    ) {
      value = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }
  if (value === null) remove(storage, key);
  else write(storage, key, value);
}
export function clearPersistedRootState(
  storage: Storage,
  threadId: string,
  rootId: string,
): void {
  remove(storage, rootStateKey(threadId, rootId));
}
