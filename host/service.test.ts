import {
  chmod,
  mkdtemp,
  mkdir,
  open,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { constants as fsConstants } from "node:fs";
import { NativeFileHostError, NativeFileHostService } from "./service.js";
import {
  createLinuxProcFdPrimitive,
  linuxDescriptorPath,
} from "./confinement.js";
import { loadNativeFilesAddon } from "./native-addon.js";
const execFileAsync = promisify(execFile);
const services: NativeFileHostService[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "bb-native-files-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(join(root, "inside"), { recursive: true });
  await mkdir(join(outside, "inside"), { recursive: true });
  await writeFile(join(root, "inside", "value.txt"), "inside");
  await writeFile(join(outside, "inside", "value.txt"), "outside");
  return { base, outside, root };
}
function service(
  hooks: ConstructorParameters<typeof NativeFileHostService>[0] = {},
  dependencies: ConstructorParameters<typeof NativeFileHostService>[1] = {},
) {
  const created = new NativeFileHostService(hooks, dependencies);
  services.push(created);
  return created;
}
async function swapDirectory(root: string, outside: string): Promise<void> {
  await rename(join(root, "inside"), join(root, "inside-original"));
  await symlink(join(outside, "inside"), join(root, "inside"), "dir");
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((entry) => entry.dispose()));
});
describe.runIf(loadNativeFilesAddon() !== null)("NativeFileHostService", () => {
  it("reads the opened file object when its pathname is swapped", async () => {
    const { outside, root } = await fixture();
    const host = service({
      afterOpen: async (operation) => {
        if (operation === "read") await swapDirectory(root, outside);
      },
    });
    const binding = await host.bindRoot(root);
    const snapshot = await host.read(
      binding.rootBindingId,
      "inside/value.txt",
      1024,
    );
    expect(snapshot.content).toBe("inside");
    expect(snapshot.contentEncoding).toBe("utf8");
  });
  it("reads the opened binary object when its pathname is swapped", async () => {
    const { outside, root } = await fixture();
    await writeFile(
      join(root, "inside", "binary.bin"),
      Buffer.from([0xff, 0x00, 0xfe]),
    );
    await writeFile(
      join(outside, "inside", "binary.bin"),
      Buffer.from("outside"),
    );
    const host = service({
      afterOpen: async (operation) => {
        if (operation === "read") await swapDirectory(root, outside);
      },
    });
    const binding = await host.bindRoot(root);
    const snapshot = await host.read(
      binding.rootBindingId,
      "inside/binary.bin",
      1024,
    );
    expect(snapshot.contentEncoding).toBe("base64");
    expect(Buffer.from(snapshot.content, "base64")).toEqual(
      Buffer.from([0xff, 0x00, 0xfe]),
    );
  });
  it.each(["transfer", "context"])(
    "prepares a stable %s snapshot when its pathname is swapped",
    async () => {
      const { outside, root } = await fixture();
      const host = service({
        afterOpen: async (operation) => {
          if (operation === "read") await swapDirectory(root, outside);
        },
      });
      const binding = await host.bindRoot(root);
      const snapshot = await host.read(
        binding.rootBindingId,
        "inside/value.txt",
        25 * 1024 * 1024,
      );
      expect(snapshot.content).toBe("inside");
    },
  );
  it("repeats and interleaves listings on the same binding", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "inside", "second.txt"), "second");
    const host = service();
    const binding = await host.bindRoot(root);
    const expected = ["second.txt", "value.txt"];
    const [firstInside, rootListing, secondInside, secondRootListing] =
      await Promise.all([
        host.listDirectory(binding.rootBindingId, "inside"),
        host.listDirectory(binding.rootBindingId, ""),
        host.listDirectory(binding.rootBindingId, "inside"),
        host.listDirectory(binding.rootBindingId, ""),
      ]);
    expect(firstInside.entries.map((entry) => entry.name)).toEqual(expected);
    expect(secondInside.entries.map((entry) => entry.name)).toEqual(expected);
    expect(rootListing.entries.map((entry) => entry.name)).toEqual(["inside"]);
    expect(secondRootListing.entries.map((entry) => entry.name)).toEqual([
      "inside",
    ]);
    const repeatedRootListing = await host.listDirectory(
      binding.rootBindingId,
      "",
    );
    expect(repeatedRootListing.entries.map((entry) => entry.name)).toEqual([
      "inside",
    ]);
  });
  it("lists the opened directory object when its pathname is swapped", async () => {
    const { outside, root } = await fixture();
    await writeFile(join(root, "inside", "only-inside.txt"), "inside");
    await writeFile(join(outside, "inside", "only-outside.txt"), "outside");
    const host = service({
      afterOpen: async (operation, relativePath) => {
        if (operation === "list" && relativePath === "inside") {
          await swapDirectory(root, outside);
        }
      },
    });
    const binding = await host.bindRoot(root);
    const result = await host.listDirectory(binding.rootBindingId, "inside");
    expect(result.entries.map((entry) => entry.name)).toContain(
      "only-inside.txt",
    );
    expect(result.entries.map((entry) => entry.name)).not.toContain(
      "only-outside.txt",
    );
  });
  it("searches opened directories without following a swapped symlink", async () => {
    const { outside, root } = await fixture();
    await writeFile(join(root, "inside", "inside-target.txt"), "inside");
    await writeFile(join(outside, "inside", "outside-target.txt"), "outside");
    let swapped = false;
    const host = service({
      afterOpen: async (operation, relativePath) => {
        if (operation === "search" && relativePath === "inside" && !swapped) {
          swapped = true;
          await swapDirectory(root, outside);
        }
      },
    });
    const binding = await host.bindRoot(root);
    const result = await host.search(
      binding.rootBindingId,
      "target",
      20,
      "search-race",
    );
    expect(result.matches.map((entry) => entry.path)).toContain(
      "inside/inside-target.txt",
    );
    expect(result.matches.map((entry) => entry.path)).not.toContain(
      "inside/outside-target.txt",
    );
  });
  it("runs Git from the bound root object after the configured path is replaced", async () => {
    const { base, root } = await fixture();
    const replacement = join(base, "replacement");
    await mkdir(replacement);
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "tracked.txt"), "tracked");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "initial",
      ],
      { cwd: root },
    );
    await writeFile(join(root, "tracked.txt"), "changed");
    const host = service({
      afterOpen: async (operation) => {
        if (operation !== "git") return;
        await rename(root, join(base, "bound-root"));
        await rename(replacement, root);
      },
    });
    const binding = await host.bindRoot(root);
    const result = await host.gitStatus(binding.rootBindingId, "git-race");
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.changes.map((change) => change.path)).toContain(
        "tracked.txt",
      );
    }
  });
  it("returns root-relative Git paths when the selected root is inside a repository", async () => {
    const { root } = await fixture();
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "inside.txt"), "inside");
    await writeFile(join(root, "outside.txt"), "outside");
    const host = service();
    const binding = await host.bindRoot(nested);
    const result = await host.gitStatus(binding.rootBindingId, "nested-git");
    expect(result.kind).toBe("ready");
    if (result.kind === "ready")
      expect(result.changes.map((change) => change.path)).toEqual([
        "inside.txt",
      ]);
  });
  it("rejects an intermediate escaping symlink", async () => {
    const { outside, root } = await fixture();
    await symlink(outside, join(root, "link"));
    const host = service();
    const binding = await host.bindRoot(root);
    await expect(
      host.read(binding.rootBindingId, "link/inside/value.txt", 1024),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^native_file_(invalid_path|not_found)$/u),
    });
    const listed = await host.listDirectory(binding.rootBindingId, "");
    expect(listed.entries.map((entry) => entry.name)).not.toContain("link");
  });
  it("does not follow GIT_DIR or GIT_WORK_TREE outside the bound root", async () => {
    const { base, root } = await fixture();
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "inside-only.txt"), "inside");
    await execFileAsync("git", ["add", "inside-only.txt"], { cwd: root });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "inside",
      ],
      { cwd: root },
    );
    const outsideRepo = join(base, "git-outside");
    await mkdir(outsideRepo);
    await execFileAsync("git", ["init", "-q"], { cwd: outsideRepo });
    await writeFile(join(outsideRepo, "home-secret.txt"), "secret");
    await execFileAsync("git", ["add", "home-secret.txt"], {
      cwd: outsideRepo,
    });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "outside",
      ],
      { cwd: outsideRepo },
    );
    const previousGitDir = process.env.GIT_DIR;
    const previousGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = join(outsideRepo, ".git");
    process.env.GIT_WORK_TREE = outsideRepo;
    const host = service();
    const binding = await host.bindRoot(root);
    try {
      const result = await host.gitStatus(binding.rootBindingId, "git-env");
      expect(result.kind).toBe("ready");
      if (result.kind === "ready") {
        expect(result.changes.map((change) => change.path)).not.toContain(
          "home-secret.txt",
        );
      }
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
      if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousGitWorkTree;
    }
  });
  it("does not execute repository-configured Git helpers", async () => {
    const { base, root } = await fixture();
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "inside.txt"), "inside");
    const marker = join(base, "fsmonitor-ran");
    const helper = join(base, "fsmonitor.sh");
    await writeFile(
      helper,
      `#!/bin/sh\necho ran > "${marker}"\nprintf '0\\n'\n`,
    );
    await chmod(helper, 0o755);
    await execFileAsync("git", ["config", "core.fsmonitor", helper], {
      cwd: root,
    });
    const host = service();
    const binding = await host.bindRoot(root);
    const result = await host.gitStatus(
      binding.rootBindingId,
      "git-repository-helper",
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.kind).toBe("ready");
  });
  it("does not execute global Git helpers", async () => {
    const { base, root } = await fixture();
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "inside.txt"), "inside");
    const home = join(base, "home");
    await mkdir(home);
    const marker = join(base, "global-fsmonitor-ran");
    const helper = join(base, "global-fsmonitor.sh");
    await writeFile(
      helper,
      `#!/bin/sh\necho ran > "${marker}"\nprintf '0\\n'\n`,
    );
    await chmod(helper, 0o755);
    await writeFile(
      join(home, ".gitconfig"),
      `[core]\n\tfsmonitor = ${helper}\n`,
    );
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const host = service();
    const binding = await host.bindRoot(root);
    try {
      const result = await host.gitStatus(
        binding.rootBindingId,
        "git-global-helper",
      );
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(result.kind).toBe("ready");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
  it("does not execute a git binary from the bound worktree", async () => {
    const { root } = await fixture();
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    const marker = join(root, "workspace-git-ran");
    await writeFile(
      join(root, "git"),
      `#!/bin/sh\necho ran > "${marker}"\nexit 1\n`,
    );
    await chmod(join(root, "git"), 0o755);
    const host = service();
    const binding = await host.bindRoot(root);
    const result = await host.gitStatus(
      binding.rootBindingId,
      "git-workspace-binary",
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.kind).not.toBe("unavailable");
  });
  it("rejects escaping symlinks and stale bindings", async () => {
    const { outside, root } = await fixture();
    await symlink(
      join(outside, "inside", "value.txt"),
      join(root, "escape.txt"),
    );
    const host = service();
    const binding = await host.bindRoot(root);
    await expect(
      host.read(binding.rootBindingId, "escape.txt", 1024),
    ).rejects.toMatchObject({
      code: "native_file_invalid_path",
    });
    await host.releaseRoot(binding.rootBindingId);
    await expect(
      host.listDirectory(binding.rootBindingId, ""),
    ).rejects.toMatchObject({
      code: "native_file_binding_unknown",
    });
  });
  it("cancels an active bounded search", async () => {
    const { root } = await fixture();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = service({
      afterOpen: async (operation) => {
        if (operation === "search") await blocked;
      },
    });
    const binding = await host.bindRoot(root);
    const pending = host.search(
      binding.rootBindingId,
      "value",
      20,
      "search-cancel",
    );
    await Promise.resolve();
    expect(host.cancel("search-cancel")).toEqual({ cancelled: true });
    release?.();
    await expect(pending).rejects.toBeInstanceOf(NativeFileHostError);
    expect(host.cancel("search-cancel")).toEqual({ cancelled: false });
  });
  it("returns a snapshot whose digest matches the returned bytes", async () => {
    const { root } = await fixture();
    const host = service();
    const binding = await host.bindRoot(root);
    const snapshot = await host.read(
      binding.rootBindingId,
      "inside/value.txt",
      1024,
    );
    const actual = await readFile(join(root, "inside", "value.txt"));
    expect(
      Buffer.from(
        snapshot.content,
        snapshot.contentEncoding === "base64" ? "base64" : "utf8",
      ),
    ).toEqual(actual);
    expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
describe("Native Files platform confinement", () => {
  it("fails closed when the descriptor addon is missing", async () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const host = service({}, { platform, nativeAddon: null });
      await expect(host.bindRoot("/tmp")).rejects.toMatchObject({
        code: "native_file_confinement_unavailable",
      });
    }
  });
  it.runIf(process.platform === "linux" && loadNativeFilesAddon() !== null)(
    "rejects traversal components before any procfs suffix is used",
    async () => {
      const { root } = await fixture();
      const host = service();
      const binding = await host.bindRoot(root);
      await expect(
        host.read(binding.rootBindingId, "../outside/inside/value.txt", 1024),
      ).rejects.toMatchObject({ code: "native_file_invalid_path" });
      await expect(
        host.read(binding.rootBindingId, "inside/../inside/value.txt", 1024),
      ).rejects.toMatchObject({ code: "native_file_invalid_path" });
    },
  );
  it.runIf(process.platform === "linux")(
    "documents that an unvalidated procfs suffix is not RESOLVE_BENEATH",
    async () => {
      const { outside, root } = await fixture();
      const primitive = createLinuxProcFdPrimitive();
      const rootFd = await primitive.openRoot(
        root,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
      );
      try {
        const escaped = await open(
          `${linuxDescriptorPath(rootFd)}/../outside/inside/value.txt`,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
        try {
          expect((await escaped.readFile()).toString("utf8")).toBe("outside");
        } finally {
          await escaped.close();
        }
      } finally {
        await primitive.close(rootFd);
      }
      expect(outside.length).toBeGreaterThan(0);
    },
  );
});
describe.runIf(loadNativeFilesAddon() !== null)(
  "Native Files compiled addon",
  () => {
    it("uses the compiled descriptor helper rather than a test fake", async () => {
      const addon = loadNativeFilesAddon();
      expect(addon).not.toBeNull();
      const { root } = await fixture();
      const host = service({}, { nativeAddon: addon });
      const binding = await host.bindRoot(root);
      const snapshot = await host.read(
        binding.rootBindingId,
        "inside/value.txt",
        1024,
      );
      expect(snapshot.content).toBe("inside");
    });
  },
);
