// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isMotionReduced } from "@/lib/motion";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path.endsWith("website") ? [] : sourceFiles(path);
    // Generated MCP view bundles embed third-party CSS as strings.
    if (/-html\.ts$/.test(path)) return [];
    return /\.(tsx?|css)$/.test(path) ? [path] : [];
  });
}

function block(selectorStart: string): string {
  const start = css.indexOf(selectorStart);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`Unclosed block ${selectorStart}`);
}

function tokens(text: string) {
  return Object.fromEntries([...text.matchAll(/(--(?:motion|ease)-[a-z-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}

const ms = (value: string) => Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);

describe("motion tokens", () => {
  const defined = tokens(block("/* Motion tokens"));

  it("defines the follow-up 08 tokens once", () => {
    expect(defined).toMatchObject({
      "--motion-instant": "80ms",
      "--motion-fast": "120ms",
      "--motion-base": "180ms",
      "--motion-slow": "240ms",
      "--motion-spin": "900ms",
      "--ease-out": "cubic-bezier(0.2, 0, 0, 1)",
      "--ease-in": "cubic-bezier(0.4, 0, 1, 1)",
      "--ease-move": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--motion-shift": "8px",
      "--motion-scale-in": "0.96",
      "--motion-press": "0.98",
    });
    expect(css.match(/--motion-fast:\s*120ms/g)).toHaveLength(1);
  });

  it("caps every duration at 240 ms except the spinner", () => {
    for (const [name, value] of Object.entries(defined)) {
      if (name === "--motion-spin" || !/m?s$/.test(value)) continue;
      expect(ms(value), name).toBeLessThanOrEqual(240);
    }
  });

  it("keeps a positioned button's transform intact during its press feedback", () => {
    const pressed = block('[data-slot="button"]:active');
    expect(pressed).toContain("scale: var(--motion-press)");
    expect(pressed).not.toMatch(/\btransform\s*:/);
  });

  it("decides reduced motion in one place: fades of at most 80 ms, no spatial movement", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    const values = tokens(reduced);
    for (const name of ["--motion-instant", "--motion-fast", "--motion-base", "--motion-slow"]) {
      expect(ms(values[name]), name).toBeLessThanOrEqual(80);
    }
    expect(values).toMatchObject({ "--motion-shift": "0px", "--motion-scale-in": "1", "--motion-press": "1" });
    expect(reduced).toMatch(/--motion-reduced:\s*1/);
    expect(reduced).toMatch(/transition-property:[^;]*opacity[^;]*!important/);
    expect(reduced).not.toMatch(/transition-property:[^;]*(transform|height|width|grid-template)/);
    expect(reduced).toMatch(/\.spin[^{]*\{\s*animation:\s*none\s*!important/);

    const elsewhere = sourceFiles(join(root, "src")).filter(file => /prefers-reduced-motion/.test(readFileSync(file, "utf8")));
    expect(elsewhere.map(file => relative(root, file))).toEqual(["src/app/globals.css"]);
    expect(css.match(/prefers-reduced-motion/g)).toHaveLength(1);
  });

  it("keeps keyboard focus rings instantaneous in reduced motion", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    const properties = reduced.match(/transition-property:\s*([^;]+);/)?.[1] ?? "";
    expect(properties).not.toMatch(/box-shadow|outline-color|\ball\b/);
  });

  it("does not lift or zoom gallery tiles on hover (follow-up 08, section 5)", () => {
    const hoverRules = [...css.matchAll(/([^{}]*\.(?:virtual|image)-card[^{}]*:hover[^{}]*)\{([^}]*)\}/g)];
    const moving = hoverRules.filter(([, , body]) => /transform|translate|scale/.test(body)).map(([, selector]) => selector.trim());
    expect(moving).toEqual([]);
  });

  it("keeps durations and curves out of the code outside the token block", () => {
    const offenders: string[] = [];
    const tokenBlock = block("/* Motion tokens");
    for (const file of sourceFiles(join(root, "src"))) {
      let text = readFileSync(file, "utf8");
      if (file.endsWith("globals.css")) text = text.replace(tokenBlock, "");
      text.split("\n").forEach((line, index) => {
        const where = `${relative(root, file)}:${index + 1}`;
        if (/(transition|animation)(-duration|-timing-function|-delay)?\s*:[^;]*\b\d*\.?\d+m?s\b/.test(line)) offenders.push(`${where} raw time`);
        if (/(transition|animation)(-timing-function)?\s*:[^;]*(cubic-bezier|(?<!-)\bease(-in|-out|-in-out)?\b|(?<!-)\blinear\b)/.test(line)) offenders.push(`${where} raw curve`);
        if (/["'`\s:](duration|delay)-\d+\b/.test(line)) offenders.push(`${where} Tailwind duration`);
        if (/["'`\s:]ease-(in|out|in-out|linear)\b/.test(line)) offenders.push(`${where} Tailwind curve`);
        if (/["'`\s]animate-(spin|pulse|bounce|ping)\b/.test(line)) offenders.push(`${where} Tailwind animation`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("isMotionReduced", () => {
  afterEach(() => document.documentElement.style.removeProperty("--motion-reduced"));

  it("reads the mode from the root token", () => {
    expect(isMotionReduced()).toBe(false);
    document.documentElement.style.setProperty("--motion-reduced", "1");
    expect(isMotionReduced()).toBe(true);
    document.documentElement.style.setProperty("--motion-reduced", "0");
    expect(isMotionReduced()).toBe(false);
  });

  it("treats a missing document as full motion", () => {
    expect(isMotionReduced(null)).toBe(false);
  });
});
