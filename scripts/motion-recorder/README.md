# Motion recorder (follow-up 08, section 8)

Frame-exact 60 fps recordings of the app's motion, plus a frame-by-frame check for dropped elements and flicker. Development tool only; not part of the app build.

## Why not screen capture

A screencast of a live tab keeps the latest frame Chrome happened to deliver: frames repeat, frames go missing, and a short state can be lost or appear twice. This recorder instead freezes all time the page can see and advances it 1/60 s (or 1/240 s for 0.25 speed) per frame, then takes a still screenshot of the settled state.

`clock.js` (injected before any page script) replaces `performance.now`, `Date`, timers, `requestAnimationFrame` and `requestIdleCallback`, and takes ownership of every Web Animation and CSS transition: each is paused at creation and its `currentTime` is set from the virtual clock. Network responses and React renders still arrive in real time, so the time between an action and a server response is not reproduced. Effects that depend on that latency are measured separately with `realtime.mjs`.

Begin-frame control (`HeadlessExperimental.beginFrame`) would be the browser's own deterministic mode, but it is not supported on macOS.

## Files

- `seed.ts` creates a fictional workspace: 2 projects, 24 generated landscape PNGs, no provider calls.
- `render.mjs <scene> <normal|quarter|reduced> <outdir>` resets the data, starts `next start`, records one scene and encodes `<scene>-<mode>.mp4` (H.264, 60 fps). `quarter` renders 4 frames per 1/60 s of page time, so the video plays at 0.25 speed with distinct frames. `reduced` emulates `prefers-reduced-motion: reduce`.
- `scenes.mjs` holds one scene per area of section 9 (P1 to P5).
- `probe.js` records per frame the effective opacity and box of transient surfaces, running animations, moving gallery cards and the preview flight copy.
- `analyze.py <rundir>` flags frames where content differs from both neighbours while the neighbours match (an element missing or extra for 1 to 3 frames), and opacity that changes direction within 6 frames.
- `sheet.py` builds contact sheets of chosen frames for visual inspection.
- `realtime.mjs` samples every real rendered frame after an action, without the virtual clock, optionally with CPU throttling.
- `perf.mjs` records a Chrome trace of the heaviest interaction per area at 4x CPU slowdown: long tasks, interaction durations and layout shifts.

## Environment

`REC_ROOT` is a work folder with `app/` (an export of the commit under test, installed and built), `data-pristine/` (seeded), and room for `data*/` and `out/`. `CHROME_PATH` points to Chrome for Testing. `REC_APP` names the built app folder inside `REC_ROOT` (default `app`). `REC_PORT` selects the port; each port needs its own seeded `data-pristine-<port>/` because projects keep absolute paths.
