// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isolatedHtmlDocument, sanitizeStaticHtml } from "./html-safety.js";
describe("isolated HTML", () => {
  it("removes scripts, active elements, handlers, styles, and network URLs", () => {
    const safe = sanitizeStaticHtml(
      '<script>steal()</script><form action="/session"><input></form><img src="https://example.test/tracker" onerror="steal()" style="display:none"><a href="/private">open</a><iframe src="/private"></iframe>',
    );
    expect(safe).not.toMatch(
      /script|form|input|iframe|onerror|style=|https:|href=/iu,
    );
    expect(safe).toContain("<img>");
    expect(safe).toContain("<a>open</a>");
  });
  it("keeps only bounded static data images and installs a deny-by-default CSP", () => {
    const document = isolatedHtmlDocument(
      '<img src="data:image/png;base64,AAAA"><img src="data:text/html;base64,AAAA">',
    );
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("data:image/png;base64,AAAA");
    expect(document).not.toContain("data:text/html");
  });
});
