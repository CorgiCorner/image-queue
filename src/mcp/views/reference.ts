import { CompactApp, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "./compact-app";
import { prepareReferenceFile, type PreparedReference } from "./reference-file";

const app = new CompactApp({ name: "image-queue-reference", version: "1.0.0" });
const status = document.querySelector<HTMLElement>("[role=status]")!;
const drop = document.querySelector<HTMLElement>("#drop")!;
const input = document.querySelector<HTMLInputElement>("#file")!;
const choose = document.querySelector<HTMLButtonElement>("#choose")!;
const list = document.querySelector<HTMLOListElement>("#uploaded")!;
let projectId = "";
let busy = false;
let disposed = false;

type Uploaded = { id: string; name: string };

function read(params: { structuredContent?: unknown; content?: { type: string; text?: string }[] }) {
  const text = params.content?.find(item => item.type === "text")?.text;
  try {
    return (params.structuredContent ?? (text ? JSON.parse(text) : undefined)) as { projectId?: string; error?: string } | undefined;
  } catch {
    return undefined;
  }
}

function setProject(value: unknown) {
  if (typeof value === "string" && value) {
    projectId = value;
    if (!busy) status.textContent = "Choose or drop the image to use as a reference.";
    choose.disabled = false;
  }
}

app.ontoolinput = params => setProject((params.arguments as { projectId?: unknown } | undefined)?.projectId);
app.ontoolresult = params => {
  const result = read(params as never);
  if (result?.error) status.textContent = result.error;
  setProject(result?.projectId);
};

async function upload(files: File[]) {
  if (busy || disposed || !files.length) return;
  if (!projectId) { status.textContent = "Waiting for the project from Claude…"; return; }
  busy = true;
  choose.disabled = true;
  const uploaded: Uploaded[] = [];
  try {
    for (const [index, file] of files.slice(0, 8).entries()) {
      status.textContent = files.length > 1 ? `Uploading ${index + 1} of ${Math.min(files.length, 8)}…` : "Uploading…";
      let prepared: PreparedReference;
      try {
        prepared = await prepareReferenceFile(file);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "This file cannot be used as a reference.";
        continue;
      }
      const result = await app.callServerTool({ name: "save_uploaded_reference", arguments: { projectId, ...prepared } });
      const text = result.content?.find(item => item.type === "text");
      const body = text && "text" in text ? JSON.parse(text.text) as { id?: string; name?: string; error?: string } : undefined;
      if (result.isError || !body?.id) {
        status.textContent = body?.error ?? "Upload failed.";
        continue;
      }
      uploaded.push({ id: body.id, name: body.name ?? prepared.name });
      const item = document.createElement("li");
      item.textContent = `${body.name ?? prepared.name}: ${body.id}`;
      list.append(item);
    }
    if (!uploaded.length) return;
    const summary = `Uploaded ${uploaded.length === 1 ? "a reference image" : `${uploaded.length} reference images`} to project ${projectId}: ` +
      uploaded.map(item => `${item.name} (referenceId ${item.id})`).join(", ") + ". Use them as referenceIds and continue.";
    let sent = false;
    try {
      const reply = await app.sendMessage({ role: "user", content: [{ type: "text", text: summary }] });
      sent = !reply?.isError;
    } catch {
      sent = false;
    }
    if (!sent) {
      try { await app.updateModelContext({ content: [{ type: "text", text: summary }] }); } catch { /* the ID stays on screen */ }
    }
    status.textContent = sent ? "Uploaded. Claude continues with the reference." : "Uploaded. Send any message so Claude continues with the reference.";
  } catch (error) {
    status.textContent = error instanceof Error ? `Upload failed: ${error.message}` : "Upload failed.";
  } finally {
    busy = false;
    choose.disabled = !projectId;
    input.value = "";
  }
}

choose.addEventListener("click", () => input.click());
input.addEventListener("change", () => void upload([...input.files ?? []]));
drop.addEventListener("dragover", event => { event.preventDefault(); drop.dataset.over = ""; });
drop.addEventListener("dragleave", () => { delete drop.dataset.over; });
drop.addEventListener("drop", event => {
  event.preventDefault();
  delete drop.dataset.over;
  void upload([...event.dataTransfer?.files ?? []]);
});
document.addEventListener("paste", event => {
  const files = [...event.clipboardData?.files ?? []];
  if (files.length) { event.preventDefault(); void upload(files); }
});

app.onhostcontextchanged = context => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
};
app.onteardown = async () => { disposed = true; return {}; };
app.connect().then(() => {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}).catch(() => { if (!disposed) status.textContent = "Unable to connect to the host."; });
