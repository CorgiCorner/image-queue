"use client";

import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Primitive.Provider delay={400} timeout={400}>{children}</Primitive.Provider>;
}

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return <Primitive.Root>
    <Primitive.Trigger render={children} />
    <Primitive.Portal>
      <Primitive.Positioner sideOffset={6} className="z-50">
        <Primitive.Popup role="tooltip" data-slot="tooltip-content" className="tooltip-content">{label}</Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  </Primitive.Root>;
}
