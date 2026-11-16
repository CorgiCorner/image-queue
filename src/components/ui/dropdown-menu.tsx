"use client";

import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, side, ...props }: Menu.Popup.Props & Pick<Menu.Positioner.Props, "side">) {
  return <Menu.Portal><Menu.Positioner side={side} sideOffset={6} align="end" className="z-50">
    <Menu.Popup data-slot="dropdown-menu-content" className={cn("min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none", className)} {...props} />
  </Menu.Positioner></Menu.Portal>;
}

export function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
  return <Menu.Item className={cn("flex min-h-9 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-muted data-disabled:opacity-50", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

export function DropdownMenuShortcut({ children }: { children: string }) {
  return <kbd aria-hidden="true" className="ml-auto text-xs text-muted-foreground">{children}</kbd>;
}
