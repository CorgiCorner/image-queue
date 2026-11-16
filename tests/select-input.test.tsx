// @vitest-environment happy-dom
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelectInput } from "../src/components/select-input";
afterEach(cleanup);
it("opens the move menu below its trigger and keeps the current project disabled", async () => {
  const change = vi.fn();
  render(<SelectInput label="Move selected images" value="" side="bottom" placeholder="Move to…" onValueChange={change}
    options={[{ value: "current", label: "Current project", disabled: true }, { value: "other", label: "Other project" }]} />);
  await userEvent.click(screen.getByRole("combobox"));
  const current = await screen.findByRole("option", { name: "Current project" });
  expect(current.getAttribute("aria-disabled")).toBe("true");
  expect(current.closest('[data-slot="select-content"]')?.getAttribute("data-side")).toBe("bottom");
  await userEvent.click(current);
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("option", { name: "Other project" }));
  expect(change).toHaveBeenCalledWith("other");
});
it("renders shadcn trigger and option styles with disabled choices", async () => {
  const change = vi.fn();
  render(
    <SelectInput
      label="Source"
      value="queue"
      onValueChange={change}
      options={[
        { value: "queue", label: "Codex queue" },
        { value: "api", label: "API key" },
        { value: "disabled", label: "Unavailable", disabled: true },
      ]}
    />,
  );
  const trigger = screen.getByRole("combobox", { name: "Source" });
  expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
  await userEvent.click(trigger);
  const option = await screen.findByRole("option", { name: "API key" });
  expect(option.getAttribute("data-slot")).toBe("select-item");
  await userEvent.click(option);
  expect(change).toHaveBeenCalledWith("api");
});
it("disables empty model lists", () => {
  render(
    <SelectInput
      label="Model"
      value=""
      placeholder="Connect provider"
      onValueChange={() => {}}
      options={[]}
    />,
  );
  expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it("supports an explicit empty choice after selecting a value", async () => {
 const changed=vi.fn();
 render(<SelectInput label="Topic" value="topic" onValueChange={changed} options={[{value:"",label:"Project only"},{value:"topic",label:"Topic"}]} />);
 const user=userEvent.setup();
 await user.click(screen.getByRole("combobox"));
 await user.click(await screen.findByRole("option",{name:"Project only"}));
 expect(changed).toHaveBeenCalledWith("");
});
