import { createRequire } from "node:module";
import DOMPurify from "dompurify";
import { marked } from "marked";

const require = createRequire(import.meta.url);

let purifier: ReturnType<typeof DOMPurify> | undefined;

/**
 * DOMPurify needs a DOM, and the only thing that supplies one here is jsdom —
 * which costs over a second to import, more than the rest of the server put
 * together. Loading it at module scope made every stdio startup pay for it,
 * including the many sessions that only ever read messages. So it is pulled in
 * on first sanitize instead.
 *
 * `createRequire` rather than `await import` keeps that load synchronous, which
 * is what lets `sanitizeHtml` stay a synchronous function for its callers.
 */
function getPurifier(): ReturnType<typeof DOMPurify> {
  if (!purifier) {
    const { JSDOM } = require("jsdom") as typeof import("jsdom");
    purifier = DOMPurify(new JSDOM("").window as any);
  }
  return purifier;
}

// Configure marked for Teams compatibility
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
});

/**
 * Converts Markdown text to sanitized HTML
 * @param markdown The markdown text to convert
 * @returns Sanitized HTML string
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  // Convert Markdown to HTML
  const rawHtml = await marked(markdown);

  // Sanitize HTML for security - allow common formatting tags safe for Teams
  const cleanHtml = getPurifier().sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "del",
      "a",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "code",
      "pre",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
    ],
    ALLOWED_ATTR: ["href", "target", "src", "alt", "title", "width", "height"],
  });

  return cleanHtml;
}

/**
 * Basic HTML sanitization for user-provided HTML content
 * @param html The HTML content to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  return getPurifier().sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "del",
      "a",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "code",
      "pre",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
    ],
    ALLOWED_ATTR: ["href", "target", "src", "alt", "title", "width", "height"],
  });
}
