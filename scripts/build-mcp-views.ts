import { build } from "esbuild";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const viewBudget = 150_000;

function reportViewSize(name: string, html: string) {
  const bytes = Buffer.byteLength(html, "utf8");
  console.log(`MCP ${name} view: ${bytes} bytes (budget: ${viewBudget} bytes)`);
  if (bytes > viewBudget) throw new Error(`MCP ${name} view exceeds the uncompressed size budget`);
}

/** Hosts cache a view by its address, so the address changes whenever the view does. */
const viewVersion = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 10);

/**
 * Shared look of the inline views. Every value comes from the host's MCP Apps
 * style variables (font, sizes, colours, radius), so a view reads as part of
 * the app that shows it; the fallbacks follow the system colour scheme.
 */
const secondaryText = "var(--color-text-secondary,color-mix(in srgb,currentColor 70%,transparent))";
const baseCss = `body{margin:0;padding:16px;font-family:var(--font-sans,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:var(--font-text-md-size,14px);line-height:var(--font-text-md-line-height,1.5);font-weight:var(--font-weight-normal,400);color:var(--color-text-primary,CanvasText);background:var(--color-background-primary,Canvas);-webkit-font-smoothing:antialiased}`;
const buttonCss = (selector: string) =>
  `${selector}{font:inherit;font-size:var(--font-text-sm-size,13px);font-weight:var(--font-weight-medium,500);min-height:40px;padding:0 14px;border:var(--border-width-regular,1px) solid var(--color-border-primary,color-mix(in srgb,currentColor 25%,transparent));border-radius:var(--border-radius-md,8px);background:transparent;color:var(--color-text-primary,inherit);cursor:pointer}` +
  `${selector}:hover:not(:disabled){background:var(--color-background-secondary,color-mix(in srgb,currentColor 8%,transparent))}` +
  `${selector}.primary{border-color:transparent;background:var(--color-background-inverse,CanvasText);color:var(--color-text-inverse,Canvas)}` +
  `${selector}.primary:hover:not(:disabled){background:var(--color-background-inverse,CanvasText);opacity:.88}` +
  `button:focus-visible{outline:2px solid var(--color-ring-primary,Highlight);outline-offset:2px}button:disabled{opacity:.6;cursor:default}`;

const result = await build({
  entryPoints: ["src/mcp/views/job.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  minify: true,
});
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>${baseCss}h1{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}p{margin:0}[role=status]{font-weight:var(--font-weight-semibold,600)}body:is([data-status=failed],[data-status=blocked],[data-status=uncertain]) [role=status]{font-weight:var(--font-weight-normal,400);color:var(--color-text-danger,light-dark(#b42318,#f08f88))}#source,#prompt,#workers-offline,#path{color:var(--color-text-secondary,color-mix(in srgb,currentColor 70%,transparent));font-size:var(--font-text-sm-size,13px);line-height:var(--font-text-sm-line-height,1.5)}#source:empty,#prompt:empty{display:none}#source{margin-top:2px}#workers-offline{margin-top:8px}.stage{margin-top:12px}.stage:not(:has(> :not([hidden]))){display:none}#prompt{margin-top:12px;overflow-wrap:anywhere}pre{margin:8px 0 0;font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:pre-wrap;overflow-wrap:anywhere}pre:empty{display:none}${buttonCss("button")}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.actions button[hidden]{display:none}.actions:not(:has(> button:not([hidden]))){display:none}#placeholder{position:relative;display:grid;place-items:center;overflow:hidden;min-height:120px;max-height:420px;max-width:100%;border-radius:var(--border-radius-lg,12px);background:var(--color-background-secondary,color-mix(in srgb,currentColor 8%,transparent))}#placeholder[hidden]{display:none}#placeholder::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,color-mix(in srgb,currentColor 10%,transparent),transparent);transform:translateX(-100%);animation:shimmer 1.4s ease-in-out infinite}#placeholder::after{content:attr(data-label);position:relative;color:var(--color-text-secondary,color-mix(in srgb,currentColor 70%,transparent));font-size:var(--font-text-sm-size,13px)}@keyframes shimmer{to{transform:translateX(100%)}}@media (prefers-reduced-motion:reduce){:root{--motion-reduced:1}#placeholder::before{animation:none}}#preview{max-width:100%;max-height:420px;object-fit:contain}#preview:not([hidden]){display:block;border-radius:var(--border-radius-lg,12px)}</style></head><body data-dashboard="__IMAGE_QUEUE_DASHBOARD__"><h1>Image request</h1><p role="status">Connecting to image-queue…</p><p id="source"></p><p id="workers-offline" role="note" hidden></p><div class="stage"><div id="placeholder" hidden role="img" aria-label="Image preview pending" data-label="Loading preview…"></div><img id="preview" hidden alt="Generated image"></div><p id="prompt"></p><pre id="path"></pre><div class="actions"><button id="download" class="primary" hidden type="button">Download</button><button id="play" hidden type="button">Play animation</button><button id="open-app" hidden type="button">Open in image-queue</button><button id="copy-path" hidden type="button">Copy path</button></div><script>${script}</script></body></html>`;
reportViewSize("job", html);
await writeFile(
  "src/mcp/views/job-html.ts",
  `// Generated by scripts/build-mcp-views.ts\nexport const jobViewHtml = ${JSON.stringify(
    html,
  )};\nexport const jobViewVersion = ${JSON.stringify(viewVersion(html))};\n`,
);

const galleryBuild = await build({
  entryPoints: ["src/mcp/views/gallery.ts"], bundle: true, write: false,
  format: "iife", platform: "browser", minify: true,
});
const galleryScript = galleryBuild.outputFiles[0].text.replaceAll("</script", "<\\/script");
const galleryHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>${baseCss}#gallery-viewport{overflow:auto;scrollbar-width:thin}#gallery{position:relative}label{position:absolute;min-width:0;border-radius:8px;background:var(--color-background-secondary,#8882)}img:not([src]){visibility:hidden}img{width:100%;height:100%;object-fit:contain;border-radius:8px;background:#8882}label span{position:absolute;bottom:0;left:0;right:0;padding:8px;background:var(--color-background-primary,Canvas);max-height:40%;overflow:auto;font-size:var(--font-text-xs-size,12px)}input{position:absolute;top:8px;left:8px;width:24px;height:24px}span{overflow-wrap:anywhere}${buttonCss("button")}#more,#display-mode{margin-top:16px}</style></head><body><button id="display-mode" hidden>Full screen</button><p role="status">Loading images…</p><div id="gallery-viewport" role="region" aria-label="Image gallery" tabindex="0"><div id="gallery"></div></div><button id="more" hidden>Load more</button><script>${galleryScript}</script></body></html>`;
reportViewSize("gallery", galleryHtml);
await writeFile("src/mcp/views/gallery-html.ts", `// Generated by scripts/build-mcp-views.ts\nexport const galleryViewHtml = ${JSON.stringify(galleryHtml)};\nexport const galleryViewVersion = ${JSON.stringify(viewVersion(galleryHtml))};\n`);

const imageBuild = await build({
  entryPoints: ["src/mcp/views/image.ts"], bundle: true, write: false,
  format: "iife", platform: "browser", minify: true,
});
const imageScript = imageBuild.outputFiles[0].text.replaceAll("</script", "<\\/script");
const imageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>${baseCss}p{margin:0}[role=status]{font-weight:var(--font-weight-semibold,600)}#source{margin-top:2px;color:${secondaryText};font-size:var(--font-text-sm-size,13px);line-height:var(--font-text-sm-line-height,1.5)}#source:empty{display:none}.image-frame{position:relative;width:fit-content;max-width:100%;margin-top:12px}img{display:block;max-width:100%;max-height:420px;object-fit:contain;border-radius:var(--border-radius-lg,12px);touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}#draft-point{pointer-events:none}.note-region{position:absolute;box-sizing:border-box;border:2px dashed white;outline:1px solid #222;pointer-events:none}.note-pin{position:absolute;z-index:1;box-sizing:border-box;display:grid;place-items:center;width:24px;height:24px;min-width:24px;min-height:24px;padding:0;transform:translate(-50%,-50%);border:2px solid var(--color-background-primary,Canvas);border-radius:50%;background:var(--color-background-inverse,CanvasText);color:var(--color-text-inverse,Canvas);font:inherit;font-size:var(--font-text-xs-size,12px);font-weight:var(--font-weight-semibold,600);line-height:1;box-shadow:0 1px 3px rgb(0 0 0/.35)}.note-pin[hidden]{display:none}#versions{display:flex;gap:8px;overflow:auto;margin-top:12px}#versions[hidden]{display:none}.label,#note-form label{font-size:var(--font-text-sm-size,13px);font-weight:var(--font-weight-medium,500)}.hint{color:${secondaryText};font-size:var(--font-text-sm-size,13px);line-height:var(--font-text-sm-line-height,1.5)}.saved{margin-top:16px}.saved:not(:has(li)),.saved[hidden],#note-form[hidden],#no-corrections[hidden]{display:none}#no-corrections{margin-top:12px}#notes{margin:4px 0 0;padding-left:20px}#note-form{display:grid;gap:8px;margin-top:16px}#note-form .hint{margin-top:-4px}#note-text::placeholder{color:${secondaryText}}#note-text{box-sizing:border-box;width:100%;min-height:72px;padding:8px 12px;border:1px solid var(--color-border-primary,color-mix(in srgb,currentColor 35%,transparent));border-radius:var(--border-radius-md,8px);background:var(--color-background-secondary,transparent);color:inherit;font:inherit;resize:vertical}.note-actions{display:flex;flex-wrap:wrap;gap:8px}#queue-notes{margin-top:12px}#queue-notes[hidden],#clear-point[hidden]{display:none}${buttonCss("button:not(.note-pin)")}button:not(.note-pin){min-width:44px}li{margin:4px 0;overflow-wrap:anywhere}</style></head><body><p role="status">Loading image…</p><p id="source"></p><div class="image-frame"><img id="preview" hidden alt="Image"><div id="pins"></div><span id="draft-point" class="note-pin" hidden aria-hidden="true">+</span></div><nav id="versions" aria-label="Image versions"></nav><p class="hint" id="no-corrections" hidden>Changes cannot be requested for this kind of image.</p><form id="note-form"><label for="note-text">Next version</label><p class="hint" id="note-hint">Describe a change and save it. If it is about one place, tap that place on the image first. Request next version then generates a new image with your saved changes.</p><textarea id="note-text" required maxlength="4000" placeholder="What should change?" aria-describedby="note-hint"></textarea><div class="note-actions"><button id="save-note" type="submit">Save change</button><button id="clear-point" type="button" hidden>Apply to whole image</button></div></form><div class="saved"><p class="label" id="notes-title">Saved changes</p><ol id="notes" aria-labelledby="notes-title"></ol><button id="queue-notes" class="primary" type="button" hidden>Request next version</button></div><script>${imageScript}</script></body></html>`;
reportViewSize("image", imageHtml);
await writeFile("src/mcp/views/image-html.ts", `// Generated by scripts/build-mcp-views.ts\nexport const imageViewHtml = ${JSON.stringify(imageHtml)};\nexport const imageViewVersion = ${JSON.stringify(viewVersion(imageHtml))};\n`);
