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
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**", "generated/**"],
  },
};
