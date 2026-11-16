import { expect, it } from "vitest";
import { jobViewHtml } from "../src/mcp/views/job-html";
it("bundles the job view without remote script or stylesheet dependencies", () => {
  expect(jobViewHtml).toContain('role="status"');
  expect(jobViewHtml).toContain('id="prompt"');
  expect(jobViewHtml).not.toMatch(/<script[^>]+src=/i);
  expect(jobViewHtml).not.toMatch(/<link[^>]+href=/i);
  expect(jobViewHtml).toContain("get_job_state");
});
