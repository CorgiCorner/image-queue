// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers({host:"127.0.0.1:3391"}) }));
import Website from "../src/app/website/page";
afterEach(cleanup);
it("uses a consistent local dashboard CTA and provides the complete manual installation", async () => {
  render(await Website());
  const dashboardLinks = screen.getAllByRole("link").filter(link => link.getAttribute("href") === "/");
  expect(dashboardLinks.length).toBeGreaterThan(0);
  expect(dashboardLinks.every(link => link.textContent?.trim() === "Open dashboard")).toBe(true);
  const commands=document.querySelector('pre[aria-label="Installation commands"]')?.textContent;
  expect(commands).toContain("git clone https://github.com/corgicorner/image-queue.git");
  expect(commands).toContain("cd image-queue");
  expect(commands).toContain("pnpm install --frozen-lockfile\npnpm build\npnpm start");
});
