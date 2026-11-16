import { aspectRatios, resolveQueueSize } from "./size-intent";
import { resolveModelSize, sizeProfileSchema, type SizeProfile } from "./size-intent";
import type { Provider } from "./schema";
export function modelSizes(provider: Provider, model: string, profile?: SizeProfile) {
  if (profile) sizeProfileSchema.parse(profile);
  if (profile?.mode === "fixed") {
    return profile.sizes.map(({ width, height }) => `${width}x${height}`);
  }
  if (profile) {
    return queueSizes.filter(size => {
      const [width, height] = size.split("x").map(Number);
      try {
        resolveModelSize(profile, { width, height });
        return true;
      } catch {
        return false;
      }
    });
  }
  if (provider === "google" || model.startsWith("google/"))
    return ["1024x1024", "1536x1024", "1024x1536", "1536x864", "864x1536"];
  return ["1024x1024", "1536x1024", "1024x1536"];
}

export function sizeLabel(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    return size;
  function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
  }
  const divisor = gcd(width, height);
  if (width * 9 === height * 21) return `${width} × ${height} · 21:9`;
  return `${width} × ${height} · ${width / divisor}:${height / divisor}`;
}

export const queueSizes = aspectRatios.map(aspectRatio => {
  const {width,height} = resolveQueueSize({aspectRatio});
  return `${width}x${height}`;
});
export function ratioFirstLabel(size: string) {
  const label = sizeLabel(size);
  const parts = label.split(" · ");
  return parts.length === 2 ? `${parts[1]} · ${parts[0]}` : label;
}

export function closestAspectSize(current: string, sizes: string[]) {
  const [width,height] = current.split("x").map(Number);
  if (!(width > 0 && height > 0) || !sizes.length) return sizes[0];
  const ratio = width / height;
  return sizes.reduce((best, candidate) => {
    const [w,h] = candidate.split("x").map(Number);
    const [bw,bh] = best.split("x").map(Number);
    return Math.abs(Math.log(w / h / ratio)) < Math.abs(Math.log(bw / bh / ratio)) ? candidate : best;
  });
}
