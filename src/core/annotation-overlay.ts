import { z } from "zod";
import { noteInput, type ImageNote } from "./notes";

/** Overlay contains geometry and numeric labels only, never note text. */
export function annotationOverlay(width: number, height: number, notes: ImageNote[]) {
  z.number().int().positive().max(32768).parse(width);
  z.number().int().positive().max(32768).parse(height);
  const radius = Math.max(12, Math.min(width, height) / 40);
  const stroke = Math.max(2, radius / 6);
  const shapes = notes.map((note, index) => {
    const parsed = noteInput.parse(note);
    if (parsed.x === undefined || parsed.y === undefined) return "";
    const x = parsed.x * width;
    const y = parsed.y * height;
    const region = parsed.w === undefined ? "" : `<rect x="${x}" y="${y}" width="${parsed.w * width}" height="${parsed.h! * height}" fill="none" stroke="white" stroke-width="${stroke}" stroke-dasharray="${stroke * 3}"/>`;
    return `${region}<circle cx="${x}" cy="${y}" r="${radius}" fill="#5f5ce6"/><text x="${x}" y="${y}" fill="white" font-family="sans-serif" font-size="${radius}" text-anchor="middle" dominant-baseline="central">${index + 1}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes}</svg>`;
}
