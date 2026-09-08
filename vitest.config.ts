import { sharedWorkerProjects } from "./vitest.shared.js";
export default {
  resolve: {
    alias: {
      "react-resizable-panels": new URL(
        "./node_modules/react-resizable-panels/dist/react-resizable-panels.browser.cjs.js",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      name: "bb-plugin-files",
      pkgDir: import.meta.dirname,
      include: ["**/*.test.ts", "**/*.test.tsx"],
      exclude: ["node_modules/**", "dist/**", "generated/**"],
    }),
  },
};
