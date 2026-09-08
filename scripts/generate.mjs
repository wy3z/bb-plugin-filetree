import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const generated = join(root, "generated");
await mkdir(generated, { recursive: true });
for (const name of ["office", "xlsx", "pptx"]) {
  const result = await build({
    entryPoints: [join(root, `ui/preview/${name}-worker-entry.ts`)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    minify: true,
  });
  await writeFile(
    join(generated, `${name}-worker.ts`),
    `export default ${JSON.stringify(result.outputFiles[0].text)};\n`,
  );
}
const prebuildDir = join(root, "prebuilds");
await mkdir(prebuildDir, { recursive: true });
if (process.platform === "linux" || process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const args = [
    require.resolve("node-gyp/bin/node-gyp.js"),
    "rebuild",
    "--release",
  ];
  if (existsSync("/usr/include/node/node.h")) args.push("--nodedir=/usr");
  const result = spawnSync(process.execPath, args, {
    cwd: join(root, "host/native"),
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Files native addon build failed");
  await writeFile(
    join(prebuildDir, `${process.platform}-${process.arch}.node`),
    await readFile(
      join(root, "host/native/build/Release/host_native_files.node"),
    ),
  );
}
const assets = {};
for (const name of await readdir(prebuildDir)) {
  if (!/^(linux|darwin)-(x64|arm64)\.node$/.test(name)) continue;
  const bytes = await readFile(join(prebuildDir, name));
  assets[name.slice(0, -5)] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    base64: bytes.toString("base64"),
  };
}
if (Object.keys(assets).length === 0)
  throw new Error("No supported native addon prebuild is available");
await writeFile(
  join(generated, "native-assets.ts"),
  `export const nativeAssets: Readonly<Record<string, { sha256: string; base64: string }>> = ${JSON.stringify(assets)};\n`,
);
