import { accessSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";
export const TRUSTED_GIT_PATH =
  process.platform === "darwin"
    ? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    : "/usr/local/bin:/usr/bin:/bin";
export function resolveTrustedGit(
  pathValue: string = TRUSTED_GIT_PATH,
): string {
  for (const dir of pathValue.split(":")) {
    if (!dir.startsWith("/")) continue;
    const candidate = join(dir, "git");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("git executable was not found in the trusted path");
}
export function scrubbedGitEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (key.startsWith("GIT_")) continue;
    if (key === "PATH") continue;
    env[key] = value;
  }
  env.PATH = TRUSTED_GIT_PATH;
  env.GIT_CONFIG = "/dev/null";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
}
export function scrubbedGitEnvPairs(
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.entries(scrubbedGitEnv(source)).flatMap(([key, value]) =>
    value === undefined ? [] : [`${key}=${value}`],
  );
}
