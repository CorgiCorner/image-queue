// @vitest-environment happy-dom
import React from "react";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

afterEach(cleanup);

it("shows an accessible tooltip on keyboard focus without swallowing the button action", async () => {
  const click = vi.fn(), user = userEvent.setup();
  render(<TooltipProvider><Button title="Download original image" onClick={click}>Download</Button></TooltipProvider>);
  await user.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe("Download original image");
  await user.keyboard("{Enter}");
  expect(click).toHaveBeenCalledOnce();
});

it("keeps a titled dropdown trigger as one button and opens its menu", async () => {
  const click = vi.fn(), user = userEvent.setup();
  render(<TooltipProvider><DropdownMenu>
    <DropdownMenuTrigger render={<Button title="More actions" aria-label="More" />}>More</DropdownMenuTrigger>
    <DropdownMenuContent><DropdownMenuItem onClick={click}>Archive</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu></TooltipProvider>);
  expect(screen.getAllByRole("button", {name:"More"})).toHaveLength(1);
  await user.click(screen.getByRole("button", {name:"More"}));
  await user.click(await screen.findByRole("menuitem", {name:"Archive"}));
  expect(click).toHaveBeenCalledOnce();
});

it("composes a tooltip around the menu trigger without swallowing its action", async () => {
  const click = vi.fn(), user = userEvent.setup();
  render(<TooltipProvider><DropdownMenu>
    <Tooltip label="More actions"><DropdownMenuTrigger render={<Button aria-label="More" />}>More</DropdownMenuTrigger></Tooltip>
    <DropdownMenuContent><DropdownMenuItem onClick={click}>Archive</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu></TooltipProvider>);
  await user.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe("More actions");
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", {name:"Archive"}));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("button", {name:"More"})).toHaveLength(1);
});

it("opens a tooltip menu with a direct pointer click before the tooltip delay", async () => {
  const user = userEvent.setup();
  render(<TooltipProvider><DropdownMenu>
    <Tooltip label="More actions"><DropdownMenuTrigger render={<Button aria-label="More" />}>More</DropdownMenuTrigger></Tooltip>
    <DropdownMenuContent><DropdownMenuItem>Archive</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu></TooltipProvider>);
  await user.click(screen.getByRole("button",{name:"More"}));
  expect(await screen.findByRole("menuitem",{name:"Archive"})).toBeTruthy();
});

it("preserves layout selection and arrow-key focus with tooltips on UI SDK toggles", async () => {
  const change = vi.fn(), user = userEvent.setup();
  render(<TooltipProvider><ToggleGroup defaultValue={["rows"]} onValueChange={change}>
    <Tooltip label="Justified rows"><Toggle value="rows" aria-label="Justified rows">Rows</Toggle></Tooltip>
    <Tooltip label="Masonry layout"><Toggle value="masonry" aria-label="Masonry layout">Masonry</Toggle></Tooltip>
  </ToggleGroup></TooltipProvider>);
  await user.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe("Justified rows");
  await user.keyboard("{ArrowRight}{Enter}");
  expect(change).toHaveBeenCalledWith(["masonry"], expect.anything());
  expect(screen.getByRole("button", {name:"Masonry layout"}).getAttribute("aria-pressed")).toBe("true");
});

it("reveals truncated text without adding an interactive element inside a tile", async () => {
  const click = vi.fn(), user = userEvent.setup();
  render(<TooltipProvider><button onClick={click}>
    <Tooltip label="The complete worker failure"><span>Short reason</span></Tooltip>
  </button></TooltipProvider>);
  await user.hover(screen.getByText("Short reason"));
  expect((await screen.findByRole("tooltip")).textContent).toBe("The complete worker failure");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await user.click(screen.getByText("Short reason"));
  expect(click).toHaveBeenCalledOnce();
});
