import type { SizeProfile } from "./size-intent";
import { UserFacingError } from "./user-facing-error";

type Frame = { width: number; height: number };

/**
 * OpenAI renders a GIF as one sheet of frames and rejects the request when the
 * sheet breaks the model's longest side or pixel budget. The grid depends only
 * on the frame count: 2 to 8 frames use 4x2 (or 2x4), 9 use 3x3, 10 to 12 use
 * 4x3 (or 3x4) and 13 to 16 use 4x4. OpenAI does not publish this. It follows
 * from the rejected sheets (4, 6 and 8 frames of 1024x1024 all tried 4096x2048
 * and 2048x4096; 9 frames tried 3072x3072) and matches the published square
 * caps for GPT Image 2.6: 960 for 2 to 9 frames, 816 for 10 to 12, 720 for 13 to 16.
 */
function grids(frameCount: number): [columns: number, rows: number][] {
  if (frameCount <= 8) return [[4, 2], [2, 4]];
  if (frameCount === 9) return [[3, 3]];
  if (frameCount <= 12) return [[4, 3], [3, 4]];
  return [[4, 4]];
}

export function gifSheetFits(profile: SizeProfile, frame: Frame, frameCount: number) {
  if (profile.mode !== "dimensions") return true;
  return grids(frameCount).some(([columns, rows]) => {
    const width = columns * frame.width;
    const height = rows * frame.height;
    return width <= profile.maxSide && height <= profile.maxSide && width * height <= profile.maxPixels;
  });
}

/** The largest square frame, on the model's pixel grid, whose sheet fits this frame count. */
function largestSquareFrame(profile: SizeProfile & { mode: "dimensions" }, frameCount: number) {
  // This application sends a frame as a model size, so it stays at or above the model's pixel minimum.
  for (let side = Math.floor(profile.maxSide / profile.multiple) * profile.multiple; side * side >= profile.minPixels; side -= profile.multiple)
    if (gifSheetFits(profile, { width: side, height: side }, frameCount)) return side;
  return undefined;
}

/** Refuses a GIF whose frame sheet the model cannot render, naming what fits. */
export function assertGifSheetFits(profile: SizeProfile, frame: Frame, frameCount: number | undefined) {
  // OpenAI defaults to 9 frames when the request names no count.
  const count = frameCount ?? 9;
  if (profile.mode !== "dimensions" || gifSheetFits(profile, frame, count)) return;
  let most = 0;
  for (let candidate = 2; candidate <= 16; candidate++) if (gifSheetFits(profile, frame, candidate)) most = candidate;
  const side = largestSquareFrame(profile, count);
  const advice = [
    side ? `use ${side}x${side} or smaller for ${count} frames` : "",
    most ? `use at most ${most} frames at this size` : "",
  ].filter(Boolean).join(", or ");
  throw new UserFacingError(
    `A GIF of ${count} frames at ${frame.width}x${frame.height} does not fit the model's frame sheet ` +
    `(longest side ${profile.maxSide} px, ${profile.maxPixels} pixels)${advice ? `: ${advice}` : ": use fewer frames"}. Nothing was sent or billed.`,
  );
}
