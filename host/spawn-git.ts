import { spawn } from "node:child_process";
import { NativeFileHostError } from "./errors.js";
import { resolveTrustedGit, scrubbedGitEnv } from "./git-env.js";
export interface SpawnGitResult {
  code: number;
  stderr: Buffer;
  stdout: Buffer;
}
export interface SpawnGitOptions {
  maxBytes: number;
  signal: AbortSignal;
  timeoutMs: number;
}
export async function spawnGitAtPath(
  cwd: string,
  args: string[],
  options: SpawnGitOptions,
): Promise<SpawnGitResult> {
  return await new Promise<SpawnGitResult>((resolve, reject) => {
    const child = spawn(resolveTrustedGit(), args, {
      cwd,
      detached: true,
      env: scrubbedGitEnv(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const kill = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
    };
    const onAbort = () => {
      kill();
      finish(
        new NativeFileHostError(
          "native_file_operation_cancelled",
          "Git operation cancelled",
        ),
      );
    };
    const append = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > options.maxBytes) {
        kill();
        finish(new Error("Git output exceeded the Native Files limit"));
        return;
      }
      target.push(chunk);
    };
    const timer = setTimeout(() => {
      kill();
      finish(new Error("Git status timed out"));
    }, options.timeoutMs);
    timer.unref();
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderr),
        stdout: Buffer.concat(stdout),
      });
    });
  });
}
