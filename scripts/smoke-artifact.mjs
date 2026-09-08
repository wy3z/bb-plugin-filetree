import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "files-artifact-"));
let harness;
try {
  const artifact = await readFile(join(root, "dist/host.js"));
  const meta = JSON.parse(
    await readFile(join(root, "dist/host.meta.json"), "utf8"),
  );
  assert.equal(
    createHash("sha256").update(artifact).digest("hex"),
    meta.artifactDigest,
  );
  const artifactPath = join(temporary, "host.mjs");
  await copyFile(join(root, "dist/host.js"), artifactPath);
  const entry = (await import(pathToFileURL(artifactPath).href)).default;
  const workspace = join(temporary, "workspace");
  const worker = join(temporary, "worker");
  await mkdir(workspace);
  await mkdir(worker);
  const bytes = Buffer.alloc(9 * 1024 * 1024, 0xff);
  await writeFile(join(workspace, "large.bin"), bytes);
  await writeFile(join(temporary, "outside.txt"), "outside sentinel");
  await symlink(join(temporary, "outside.txt"), join(workspace, "escape.txt"));
  harness = experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir: temporary, tempDir: worker },
  });
  const listing = await harness.experimental_call("directory", {
    rootPath: workspace,
    path: "",
  });
  assert.deepEqual(
    listing.entries.map((item) => item.name),
    ["large.bin"],
  );
  await assert.rejects(
    harness.experimental_call("directory", {
      rootPath: workspace,
      path: "escape.txt",
    }),
  );
  const search = await harness.experimental_call("search", {
    rootPath: workspace,
    query: "large",
    limit: 20,
  });
  assert.deepEqual(
    search.matches.map((item) => item.path),
    ["large.bin"],
  );
  console.log(
    "PASS: isolated host artifact, embedded native addon, directory/search and symlink confinement",
  );
} finally {
  await harness?.experimental_dispose();
  await rm(temporary, { recursive: true, force: true });
}
