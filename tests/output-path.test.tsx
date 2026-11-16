// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutputPath } from "../src/components/output-path";
afterEach(cleanup);
it.each([["", "Users", "private", "project", "image.png"].join("/"), ["", "home", "private", "project", "image.png"].join("/"), "C:\\Users\\private\\project\\image.png"])("hides the home name while copying the original path %s", async path => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {configurable:true, value:{writeText}});
  const notice = vi.fn();
  render(<OutputPath path={path} onNotice={notice} />);
  expect(screen.getByText("image.png")).toBeTruthy();
  expect(screen.getByText("~/project/")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Copy path"}));
  await waitFor(() => expect(notice).toHaveBeenCalledWith("Output path copied"));
  expect(writeText).toHaveBeenCalledWith(path);
});
it("reports a clipboard failure", async () => {
  Object.defineProperty(navigator, "clipboard", {configurable:true, value:{writeText:vi.fn().mockRejectedValue(new Error("denied"))}});
  const notice = vi.fn();
  render(<OutputPath path="image.png" onNotice={notice} />);
  fireEvent.click(screen.getByRole("button", {name:"Copy path"}));
  await waitFor(() => expect(notice).toHaveBeenCalledWith("Unable to copy output path"));
});
