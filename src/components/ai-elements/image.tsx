import type { Experimental_GeneratedImage } from "ai";
import type { CSSProperties, ReactEventHandler } from "react";
import { cn } from "@/lib/utils";

// URL support keeps gallery images cacheable without embedding base64 in the page.
export type ImageProps = Partial<Experimental_GeneratedImage> & {
  src?: string;
  srcSet?: string;
  sizes?: string;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  className?: string;
  style?: CSSProperties;
  alt?: string;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onError?: ReactEventHandler<HTMLImageElement>;
};

export const Image = ({
  base64,
  uint8Array: _uint8Array,
  mediaType,
  src,
  ...props
}: ImageProps) => (
  <img
    {...props}
    alt={props.alt}
    className={cn(
      "h-auto max-w-full overflow-hidden rounded-md",
      props.className,
    )}
    src={src ?? `data:${mediaType};base64,${base64}`}
  />
);
