import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8");

function block(selectorStart: string, from = 0): string {
  const start = css.indexOf(selectorStart, from);
  expect(start, selectorStart).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`Unclosed block ${selectorStart}`);
}
const rules = (selector: string) =>
  [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))].map(match => match[1]);

describe("notification placement (owner decision 1)", () => {
  const position = rules(".toast").find(body => /position:\s*fixed/.test(body))!;

  it("anchors to the bottom-right corner with the content gutter as inset", () => {
    expect(position).toMatch(/right:\s*var\(--toast-inset\)/);
    expect(position).not.toMatch(/\bleft:|translateX|transform:/);
    expect(position).toMatch(/max-width:\s*min\(420px,\s*calc\(100vw - var\(--toast-start\) - 2 \* var\(--toast-inset\)\)\)/);
  });

  it("stands above the measured editor instead of a fixed offset and above the New image button", () => {
    expect(position).toMatch(/bottom:\s*max\(var\(--toast-floor\),\s*calc\(var\(--toast-editor-offset, 0px\) \+ var\(--toast-gap\)\)\)/);
    expect(css).not.toMatch(/bottom:\s*(205|230)px/);
    expect(block(".workspace:has(.composer-restore)")).toMatch(/--toast-floor:\s*calc\(24px \+ var\(--spacing\) \* 8 \+ var\(--toast-gap\)\)/);
  });

  it("matches the content padding and lines up with the editor edges on phones, where the sidebar becomes a top bar", () => {
    const base = rules(".workspace").find(body => body.includes("--toast-inset"))!;
    expect(base).toMatch(/--toast-inset:\s*35px/);
    expect(base).toMatch(/--toast-start:\s*230px/);
    expect(block("@media (max-width: 1150px)")).toMatch(/\.workspace\s*\{\s*--toast-inset:\s*24px;/);
    expect(block("@media (max-width: 850px)")).toMatch(/\.workspace\s*\{\s*--toast-inset:\s*20px;\s*--toast-start:\s*190px;/);
    const phone = css.indexOf("--toast-inset: 14px");
    expect(phone).toBeGreaterThan(css.indexOf("@media (max-width: 600px)"));
    expect(css.slice(phone, phone + 60)).toMatch(/--toast-start:\s*0px/);
  });

  it("keeps the motion tokens, and reduced motion ends at the final state with only a short fade", () => {
    const motion = rules(".toast").find(body => /transition:/.test(body))!;
    expect(motion).toMatch(/opacity:\s*1/);
    expect(motion).toMatch(/translate:\s*0 0/);
    expect(motion).toMatch(/transition:\s*opacity var\(--motion-base\) var\(--ease-out\), translate var\(--motion-base\) var\(--ease-out\)/);
    expect(block("@starting-style")).toMatch(/\.toast\s*\{\s*opacity:\s*0;\s*translate:\s*0 var\(--motion-shift\);/);
    expect(block(".toast[data-closing]")).toMatch(/transition-duration:\s*var\(--motion-fast\);[\s\S]*var\(--ease-in\)/);
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    expect(reduced).toMatch(/--motion-shift:\s*0px/);
    expect(reduced).toMatch(/--motion-base:\s*80ms/);
    expect(reduced).toMatch(/--motion-fast:\s*80ms/);
  });
});
