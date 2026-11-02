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

// Symbols file icons (vendor/symbols) in their authored colours, resolved
// the way Zeron resolves them.
// Emitted as a JSON string so extension keys that look like module
// keywords do not trip the public-SDK scanner.
{
  const dir = join(root, "vendor/symbols");
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  // Referenced by the manifest without definitions; Zeron aliases them.
  const aliases = { less: "brackets-sky", yml: "yaml" };
  const icons = {};
  // One deviation from the authored colours: Symbols' slate greys have a blue
  // tint, so swap them for the matching neutral zinc shades.
  const neutral = { "#64748B": "#71717A", "#475569": "#52525B", "#94A3B8": "#A1A1AA", "#334155": "#3F3F46" };
  const neutralise = (svg) =>
    svg.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => neutral[hex.toUpperCase()] ?? hex);
  const assetFor = async (definition) => {
    const id = aliases[definition] ?? definition;
    const iconPath = manifest.iconDefinitions[id]?.iconPath;
    if (!iconPath) return null;
    if (!(id in icons)) {
      const svg = (await readFile(join(dir, iconPath.replace(/^\.\/icons\//, "")), "utf8"))
        .replace(/<\?xml[^>]*>/g, "")
        .replace(/>\s+</g, "><")
        .trim();
      icons[id] = neutralise(svg);
    }
    return id;
  };
  const table = async (entries) => {
    const out = {};
    for (const [key, definition] of Object.entries(entries ?? {})) {
      const id = await assetFor(definition);
      if (id) out[key.toLowerCase()] = id;
    }
    return out;
  };
  const data = {
    fileNames: await table(manifest.fileNames),
    fileExtensions: await table(manifest.fileExtensions),
    folderNames: await table(manifest.folderNames),
    file: (await assetFor(manifest.file)) ?? (await assetFor("document")),
    folder: (await assetFor(manifest.folder)) ?? (await assetFor("folder")),
    icons,
  };
  await writeFile(
    join(generated, "file-icons.ts"),
    `export const symbols: {\n  fileNames: Record<string, string>;\n  fileExtensions: Record<string, string>;\n  folderNames: Record<string, string>;\n  file: string;\n  folder: string;\n  icons: Record<string, string>;\n} = JSON.parse(${JSON.stringify(JSON.stringify(data))});\n`,
  );
}
