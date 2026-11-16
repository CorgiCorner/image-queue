import { z } from "zod";

export const customSizesStorageKey = "image-queue-custom-sizes";
const size = z.string().regex(/^\d+x\d+$/).refine(value =>
  value.split("x").every(side => Number(side) >= 256 && Number(side) <= 4096));
const saved = z.object({ sizes: z.array(size).max(50), selected: size.optional() });
export function readCustomSizes(raw: string | null): { sizes: string[]; selected?: string } {
  try {
    const parsed = saved.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success ? { ...parsed.data, sizes: [...new Set(parsed.data.sizes)] } : { sizes: [] };
  } catch { return { sizes: [] }; }
}
export function rememberCustomSize(sizes: string[], value: string): string[] {
  return [...new Set([size.parse(value), ...sizes])].slice(0, 50);
}
