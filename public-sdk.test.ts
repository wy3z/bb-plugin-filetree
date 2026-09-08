import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

describe("standalone plugin imports", () => {
  it("uses public packages and keeps native loading confined to its artifact loader", () => {
    const result = experimental_scanPublicSdkOnly(import.meta.dirname, {
      allow: [
        /^react(?:-dom)?$/,
        /^@testing-library\/react$/,
        /^@get-bb\/plugin-sdk\/testing\/host$/,
        /^mime-types$/,
        /^dompurify$/,
        /^mammoth(?:\/.*)?$/,
        /^pptx-viewer(?:\/.*)?$/,
        /^read-excel-file(?:\/.*)?$/,
        /^@xmldom\/xmldom$/,
        /^@radix-ui\/react-slot$/,
        /^@radix-ui\/react-context-menu$/,
        /^@radix-ui\/react-dropdown-menu$/,
        /^clsx$/,
        /^sonner$/,
        /^@radix-ui\/react-tooltip$/,
        /^class-variance-authority$/,
        /^react-resizable-panels$/,
        /^@hugeicons\/(core-free-icons|react)$/,
        /^tailwind-merge$/,
        /^esbuild$/,
        /^vitest\/(config|node)$/,
      ],
    });
    expect(result.privateDependencies).toEqual([]);
    expect(result.violations).toEqual([
      {
        file: "host/native-addon.ts",
        specifier: "candidate",
        reason: "dynamic-specifier",
      },
      {
        file: "scripts/smoke-artifact.mjs",
        specifier: "pathToFileURL(artifactPath",
        reason: "dynamic-specifier",
      },
    ]);
  });
});
