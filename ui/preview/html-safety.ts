import DOMPurify from "dompurify";
const forbiddenTags = [
  "base",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "style",
  "textarea",
];
const urlAttributes = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "ping",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);
const safeDataImage =
  /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/iu;
export function sanitizeStaticHtml(markup: string): string {
  const sanitized = DOMPurify.sanitize(markup, {
    FORBID_ATTR: ["style", "srcdoc"],
    FORBID_TAGS: forbiddenTags,
    RETURN_TRUSTED_TYPE: false,
    USE_PROFILES: { html: true },
  });
  const document = new DOMParser().parseFromString(sanitized, "text/html");
  for (const element of document.body.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (!urlAttributes.has(name)) continue;
      if (name === "src" && safeDataImage.test(attribute.value)) continue;
      element.removeAttribute(attribute.name);
    }
  }
  return document.body.innerHTML;
}
export function isolatedHtmlDocument(markup: string): string {
  const safeMarkup = sanitizeStaticHtml(markup);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:15px/1.55 system-ui,sans-serif;margin:24px}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid;padding:6px;text-align:left}pre{white-space:pre-wrap}</style></head><body>${safeMarkup}</body></html>`;
}
