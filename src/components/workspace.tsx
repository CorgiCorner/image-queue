"use client";
import { isSizeMismatchError } from "@/core/job-recovery";
import { reservationTime } from "@/core/reservation-time";
import { customSizesStorageKey, readCustomSizes, rememberCustomSize } from "@/core/custom-sizes";
import { modelsWithSizeProfiles } from "@/core/model-catalog";
import { type McpLaunch } from "@/core/mcp-configuration";
import { isReserved, jobStatusLabels as labels } from "@/core/job-status";
import { orderedVersions } from "@/core/version-order";
import { annotationSelection } from "@/core/annotation";
import { aspectRatios, resolveModelSize, type SizeProfile } from "@/core/size-intent";
import { retentionSelection, visibleJobs } from "@/core/retention";
import { MAX_TAG_LENGTH, tagCounts } from "@/core/tags";
import { defaultGenerationSource, jobCounts, pulseIsFresh, queueWaitNotice, workerHealth, workerStatusMessage } from "@/core/workspace-state";
import { modelSizes, sizeLabel, queueSizes, ratioFirstLabel, closestAspectSize } from "@/core/model-options";
import { SelectInput } from "./select-input";
import { ProjectFolderSettings } from "./project-folder-settings";
import { OutputPath } from "./output-path";
import { openSharedImage } from "@/lib/shared-image-motion";
import { ExpandablePrompt } from "./expandable-prompt";
import { animateHeightChange } from "@/lib/height-motion";
import { ReferenceStrip } from "./reference-strip";
import { ChangingLabel } from "./changing-label";
import { animateRetainedCards } from "@/lib/retention-motion";
import { anyTileVisible, galleryVisibleArea } from "@/lib/tile-visibility";
import { GalleryContent } from "./gallery-content";
import { SelectionToolbar } from "./selection-toolbar";
import { Notification } from "./notification";
import { SavedStatus } from "./saved-status";
import { CopyButton } from "./copy-button";
import { SettingsNav } from "./settings-nav";
import { ConnectedProviderRow } from "./connected-provider-row";
import { AgentConnection } from "./agent-connection";
import { Progress } from "./ui/progress";
import { ImageNotes } from "./image-notes";
import { WorkerAlert } from "./worker-alert";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { animateNavigation, navigationPositions } from "@/lib/navigation-motion";
import { applyTheme } from "@/lib/apply-theme";
import { FirstGenerationCelebration } from "./first-generation-celebration";
import { projectLinks } from "@/lib/project-links";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Checkbox } from "./ui/checkbox";
import { zodResolver } from "@hookform/resolvers/zod";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { Archive, Trash, Warning, Question, Slideshow, ArrowUp, ArrowUpRight, CaretLeft as ChevronLeft, CaretRight as ChevronRight, ArrowsIn as Minimize2, Check, Clock as Clock3, DotsThree, DownloadSimple as Download, Folder, GithubLogo, Image as ImageIcon, Tray as Inbox, Stack as Layers3, SquaresFour as LayoutGrid, Rows, Columns, GridFour, CircleNotch as LoaderCircle, Moon, Paperclip, Plus, MagnifyingGlass as Search, SlidersHorizontal as Settings2, Sparkle as Sparkles, Sun, Terminal, X, XLogo } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  retentionAction,
  purgeAction,
  undoRetentionAction,
  cancelAction,
  connectAction,
  disconnectAction,
  createProjectAction,
  createTopicAction,
  pinAction,
  moveToTopicAction,
  reorderAction,
  placeBeforeAction,
  moveTopicAction,
  deleteTopicAction,
  renameTopicAction,
  editTagAction,
  rebuildIndexAction,
  joinStackAction,
  mainVersionAction,
  addNoteAction,
  markNotesAction,
  correctionAction,
  moveJobAction,
  poolConfigAction,
  recheckLocalRunnerAction,
  pauseLocalRunnerAction,
  pathSettingsAction,
  requestImageAction,
  generationSourceAction,
  retryBlockedQueueAction,
  retryImageAction,
  markUncertainFailedAction,
  inspectReservationAction,
  revealQueueImageAction,
} from "@/actions";
import { ImageTags } from "./image-tags";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LayoutMode } from "@/core/layout";
import { defaultPool, workerModels, workerEfforts, workerConfigurationPrompt, type PoolConfig, type Pulse } from "@/core/pool";
import { workerSetupLink } from "@/core/worker-setup";
import {
  requestSchema,
  type Job,
  type Model,
  type Project,
  type Reference,
} from "@/core/schema";
import { ImageIndex } from "@/core/search";
import { stackedImages } from "@/core/stacks";
import { Gallery } from "./gallery";
import { ImagePreview } from "./image-preview";

type State = {
  generationSource?: {source:"queue"|"api";provider?:"openai";model?:string};
  platformSupport?: {tested:boolean;platform:string;architecture:string;warning?:string};
  localRunner?: {mode:string;running:number;enabled:number;desiredWorkers?:number;paused?:boolean;blockedReason?:string;blockedJobId?:string;canResume?:boolean;resumeAt?:string};
  mcpLaunch?: McpLaunch;
  projects: Project[];
  jobs: Job[];
  references: Reference[];
  models: Model[];
  cloud: boolean;
  pool: PoolConfig;
  pulses: Pulse[];
  notes?: import("@/core/notes").ImageNote[];
  topics?: import("@/core/organization").Topic[];
  pins?: import("@/core/organization").Pin[];
  stackCounters?: { id: string; lastVersion: number }[];
  paths?: { queueDirectory: string; referenceDirectories: string[] };
};
const providerLabels = {
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  gateway: "Vercel AI Gateway",
} as const;
const providerOptions = [{ value: "openai", label: "OpenAI" }];

const empty: State = {
  projects: [],
  jobs: [],
  references: [],
  models: [],
  cloud: false,
  pool: defaultPool,
  pulses: [],
};
const formSchema = requestSchema.pick({ prompt: true });

function asset(job: Job, thumb = true) {
  return `/api/asset?job=${encodeURIComponent(job.id)}${thumb ? "&thumb=1" : ""}`;
}
function title(job: Job) {
  return job.id.replace(/^IMG-/, "").replace(/-/g, " ");
}

function closestCustomDimensions(width: number, ratio: string, profile?: SizeProfile) {
  const [widthUnit, heightUnit] = ratio.split(":").map(Number);
  const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : left;
  const divisor = gcd(widthUnit, heightUnit);
  const horizontal = widthUnit / divisor;
  const vertical = heightUnit / divisor;
  const min = Math.ceil(256 / Math.min(horizontal, vertical));
  const max = Math.floor(4096 / Math.max(horizontal, vertical));
  const scale = Math.max(min, Math.min(max, Math.round(width / horizontal)));
  if (!profile) return { width: scale * horizontal, height: scale * vertical };
  if (profile.mode === "aspect-ratio" && !profile.ratios.some(value => {
    const [w, h] = value.split(":").map(Number);
    return w * vertical === h * horizontal;
  })) return;
  if (profile.mode === "dimensions") {
    const ratio = horizontal / vertical;
    if (ratio < profile.minRatio || ratio > profile.maxRatio) return;
    const area = horizontal * vertical;
    const lower = Math.max(min, profile.minSide / Math.min(horizontal, vertical), Math.sqrt(profile.minPixels / area));
    const upper = Math.min(max, profile.maxSide / Math.max(horizontal, vertical), Math.sqrt(profile.maxPixels / area));
    const step = profile.multiple;
    const first = Math.ceil(lower / step);
    const last = Math.floor(upper / step);
    if (first > last) return;
    const units = Math.max(first, Math.min(last, Math.round(width / (horizontal * step))));
    const dimensions = { width: units * step * horizontal, height: units * step * vertical };
    try {
      return resolveModelSize(profile, dimensions).target;
    } catch {
      return;
    }
  }
  const scales = Array.from({ length: max - min + 1 }, (_, index) => min + index)
    .sort((left, right) => Math.abs(left * horizontal - width) - Math.abs(right * horizontal - width));
  for (const candidate of scales) {
    const dimensions = { width: candidate * horizontal, height: candidate * vertical };
    try {
      resolveModelSize(profile, dimensions);
      return dimensions;
    } catch {
      // Continue to the nearest dimensions accepted by the model.
    }
  }
}

export function Workspace({
  initialProject = "all",
  initialJob,
  initialState,
  initialView,
  settingsPage = false,
  settingsHomeDirectory,
  initialProvider = "openai",
}: {
  initialProject?: string;
  initialJob?: string;
  initialState?: State;
  initialView?: "archive" | "trash" | "queue";
  settingsPage?: boolean;
  settingsHomeDirectory?: string;
  initialProvider?: "openai" | "google" | "gateway" | "openrouter";
}) {
  const [data, setData] = useState<State>(initialState ?? empty);
  const [healthNow, setHealthNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setHealthNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const [loaded, setLoaded] = useState(Boolean(initialState));
  const [dashboardOrigin, setDashboardOrigin] = useState<string>();
  useEffect(() => setDashboardOrigin(window.location.origin), []);
  const focusComposerAfterDetail = useRef(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [pinsExpanded, setPinsExpanded] = useState(true);
  const [topic, setTopic] = useState("");
  const [destinationTopic, setDestinationTopic] = useState("");
  const [newTopic, setNewTopic] = useState(false);
  const [stackPicker, setStackPicker] = useState(false);
  const [stackSearch, setStackSearch] = useState("");
  const [stackLimit, setStackLimit] = useState(60);
  const [stackError, setStackError] = useState("");
  const [joiningStack, setJoiningStack] = useState(false);
  const stackJoinPending = useRef(false);
  const [activeNote, setActiveNote] = useState("");
  const [iterationPrompt, setIterationPrompt] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const noteSavePending = useRef(false);
  const [notePoint, setNotePoint] = useState<
    { x: number; y: number; w?: number; h?: number } | undefined
  >();
  const annotationStart = useRef<{ pointerId: number; x: number; y: number } | undefined>(
    undefined,
  );
  const [tagFrom, setTagFrom] = useState("");
  const [tagTo, setTagTo] = useState("");
  const [savingLibraryTag, setSavingLibraryTag] = useState(false);
  const libraryTagPending = useRef(false);
  const [tagEditorId, setTagEditorId] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [renameTopicName, setRenameTopicName] = useState("");
  const [topicName, setTopicName] = useState("");
  const [topicError, setTopicError] = useState("");
  const [project, setProject] = useState(initialProject);
  function navigateProject(id: string) {
    setMobileMenu(false);
    setTopic("");
    setTagFilter("");
    setRetentionView("active");
    if (!settingsPage) window.history.replaceState({}, "", id === "all" ? "/" : `/p/${id}`);
    if (settingsPage) router.push(id === "all" ? "/" : `/p/${id}`);
    else {
      setProject(id);
      setQueuePage(false);
    }
  }
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const workspaceRoot = useRef<HTMLDivElement>(null);
  const workspaceMain = useRef<HTMLElement>(null);
  const composerWrap = useRef<HTMLDivElement>(null);
  const composerSurface = useRef<HTMLFormElement>(null);
  const composerHeight = useRef(0);
  const gallerySearchInput = useRef<HTMLInputElement>(null);
  const galleryHeading = useRef<HTMLHeadingElement>(null);
  const directDetailFocus = useRef(Boolean(initialJob));
  useLayoutEffect(() => {
    const root = workspaceRoot.current;
    const main = workspaceMain.current;
    const composer = composerWrap.current;
    if (!root || !main || !composer) return;
    const update = () => {
      const wrap = composer.getBoundingClientRect();
      const clearance = Math.ceil(wrap.height);
      const form = composerSurface.current?.getBoundingClientRect();
      // The first layout effect owns initialization, so mount never animates from a partial height.
      if (composerHeight.current) composerHeight.current = form?.height ?? 0;
      main.style.setProperty("--composer-clearance", `${clearance}px`);
      // Notifications stand just above the editor's top edge; a hidden editor leaves them in the corner.
      if (clearance && form?.height) root.style.setProperty("--toast-editor-offset", `${Math.ceil(wrap.bottom - form.top)}px`);
      else root.style.removeProperty("--toast-editor-offset");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--composer-clearance");
      root.style.removeProperty("--toast-editor-offset");
    };
  }, [settingsPage]);
  const draggedNavigation = useRef<{ collection: string; id: string } | null>(null);
  const pendingNavigationMotion = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const before = pendingNavigationMotion.current;
    if (!before) return;
    pendingNavigationMotion.current = null;
    return animateNavigation(before);
  }, [data.projects, data.topics, data.pins]);
  const [navigationTarget, setNavigationTarget] = useState<{ key: string; kind: "before" | "after" | "receive" } | null>(null);
  const [retentionDrop, setRetentionDrop] = useState<"archive" | "trash" | null>(null);
  const [retentionView, setRetentionView] = useState<"active" | "archive" | "trash">(initialView === "archive" || initialView === "trash" ? initialView : "active");
  const [stacked, setStacked] = useState(true);
  const [view, setView] = useState<LayoutMode>("justified");
  const [filter, setFilter] = useState("all");
  const filterRow = useRef<HTMLDivElement>(null);
  const [filterEdges, setFilterEdges] = useState({left:false,right:false});
  const measureFilters = useCallback(() => {
    const row=filterRow.current;
    if(row) setFilterEdges({left:row.scrollLeft > 1,right:row.scrollLeft + row.clientWidth < row.scrollWidth - 1});
  },[]);
  const [tagFilter, setTagFilter] = useState("");
  const [queuePage, setQueuePage] = useState(initialView === "queue");
  useEffect(() => {
    const initialView = new URLSearchParams(window.location.search).get("view");
    if (initialView === "archive" || initialView === "trash") setRetentionView(initialView);
    if (initialView === "queue") {
      setQueuePage(true);
      setFilter("all");
    }
  }, []);
  const [variants, setVariants] = useState("1");
  const [destination, setDestination] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const settings = settingsPage;
  const [mobileMenu, setMobileMenu] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileMenu) return;
    const closeNavigation = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      setMobileMenu(false);
      navigationToggle.current?.focus();
    };
    window.addEventListener("keydown", closeNavigation);
    return () => window.removeEventListener("keydown", closeNavigation);
  }, [mobileMenu]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDirectory, setProjectDirectory] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const creatingProjectPending = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [removeExternal, setRemoveExternal] = useState(false);
  const [purgeIds, setPurgeIds] = useState<string[]>([]);
  const purgeSummary = useMemo(() => {
    const ids = new Set(purgeIds);
    const summary = { stored: 0, external: 0, withoutImage: 0 };
    for (const job of data.jobs) {
      if (!ids.has(job.id)) continue;
      if (job.blobKey) summary.stored++;
      else if (job.source === "queue" && job.status === "done" && job.outputPath) summary.external++;
      else summary.withoutImage++;
    }
    return summary;
  }, [data.jobs, purgeIds]);
  const [purgeProgress, setPurgeProgress] = useState({ processed: 0, deleted: 0 });
  const [purging, setPurging] = useState(false);
  const purgePending = useRef(false);
  const purgeCancel = useRef<HTMLButtonElement>(null);
  const [purgeError, setPurgeError] = useState("");
  const [selected, setSelected] = useState<Job | null>(() => initialState?.jobs.find((job) => job.id === initialJob) ?? null);
  const closingDetail = useRef<Job | null>(null);
  if (selected) closingDetail.current = selected;
  const detailJob = selected ?? closingDetail.current;
  const priorSelected = useRef(selected);
  useLayoutEffect(() => {
    const previous = priorSelected.current;
    priorSelected.current = selected;
    if (selected || !previous || previous.status !== "done") return;
    const target = document.querySelector<HTMLElement>(".detail-dialog .progressive-image");
    const source = [...document.querySelectorAll<HTMLButtonElement>(".virtual-card[data-job-id]")]
      .find(card => card.dataset.jobId === previous.id)?.querySelector<HTMLImageElement>("img");
    if (target && source) return openSharedImage(target, source, true);
  }, [selected]);

  useEffect(() => {
    setPromptExpanded(false);
    setIterationPrompt("");
    setNotePoint(undefined);
    annotationStart.current = undefined;
  }, [selected?.id]);
  useEffect(() => {
    versionStrip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({block:"nearest",inline:"nearest"});
  }, [selected?.id]);
  const [source, setSource] = useState<"queue" | "api">(defaultGenerationSource(initialState ?? empty));
  const [savingSource, setSavingSource] = useState(false);
  const sourceSavePending = useRef(false);
  const priorComposerSource = useRef(source);
  const [provider, setProvider] = useState<
    "openai" | "google" | "gateway" | "openrouter"
  >("openai");
  const [model, setModel] = useState(initialState?.generationSource?.model ?? "");
  const [resolution, setResolution] = useState("");
  const [customDimensionsSelected, setCustomDimensionsSelected] = useState(false);
  const [sizeFallback, setSizeFallback] = useState<{ before: string; after: string } | null>(null);
  const [size, setSize] = useState("1024x1024");
  const [savedCustomSizes, setSavedCustomSizes] = useState<string[]>([]);
  const [customSizesLoaded, setCustomSizesLoaded] = useState(false);
  const [customSize, setCustomSize] = useState(false);
  const [customSizeError, setCustomSizeError] = useState("");
  const [customRatio, setCustomRatio] = useState("free");
  const [customWidth, setCustomWidth] = useState("1080");
  const [customHeight, setCustomHeight] = useState("1920");
  const [transparent, setTransparent] = useState(false);
  const [refs, setRefs] = useState<string[]>([]);
  const [poolDraft, setPoolDraft] = useState<PoolConfig>(initialState?.pool ?? defaultPool);
  const [poolSaveRevision, setPoolSaveRevision] = useState(0);
  const [poolSaving, setPoolSaving] = useState(false);
  const [directorySaveRevision, setDirectorySaveRevision] = useState(0);
  const poolInitialized = useRef(Boolean(initialState));
  const initialJobOpened = useRef(Boolean(initialState));
  const [queueDirectory, setQueueDirectory] = useState(initialState?.paths?.queueDirectory ?? "");
  const [referenceDirectories, setReferenceDirectories] = useState(initialState?.paths?.referenceDirectories.join("\n") ?? "");
  const [apiKey, setApiKey] = useState("");
  const [providerError, setProviderError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<{ jobId: string; action: "retry" | "mark-failed" }>();
  const detailPendingRecovery = pendingRecovery?.jobId === detailJob?.id ? pendingRecovery?.action : undefined;
  const [notice, setNotice] = useState("");
  const [providerSuccess, setProviderSuccess] = useState("");
  // Bumps per provider whenever its key is replaced, so a connection test of the old key is dropped.
  const [keyRevisions, setKeyRevisions] = useState<Partial<Record<string, number>>>({});
  useEffect(() => {
    if (selected) setNotice("");
  }, [selected?.id]);

  const [undoHistory, setUndoHistory] = useState<string[]>([]);
  const undoId = undoHistory.at(-1);
  // The notice text a retention action produced; only that notice offers Undo.
  const [undoNotice, setUndoNotice] = useState<string>();
  const showRetentionNotice = useCallback((message: string, undoable: boolean) => {
    setNotice(message);
    setUndoNotice(undoable ? message : undefined);
  }, []);
  const undoPending = useRef(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [dark, setDark] = useState(true);
  const [library, setLibrary] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const pendingImport = useRef(Promise.resolve());
  const promptInput = useRef<HTMLTextAreaElement | null>(null);
  const nextVersionInput = useRef<HTMLTextAreaElement | null>(null);
  const versionStrip = useRef<HTMLDivElement | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const pendingReferenceDrop = useRef<{ jobs: Job[]; files: File[] } | null>(null);
  const correctionPending = useRef(false);
  const correctionRequest = useRef<{
    imageId: string;
    instruction: string;
    notesSignature: string;
    generationSignature: string;
    key: string;
    referenceIds: string[];
  } | null>(null);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { prompt: "" },
  });
  const promptEmpty = !form.watch("prompt")?.trim();
  const pendingRestoreMotion = useRef(false);
  const pendingInsertionMotion = useRef(false);
  const [restoreMotionRevision, setRestoreMotionRevision] = useState(0);
  const [removalMotionRevision, setRemovalMotionRevision] = useState(0);
  const [insertionMotionRevision, setInsertionMotionRevision] = useState(0);
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const refresh = useCallback(async () => {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Could not load workspace");
    const state = await response.json();
    if (!poolInitialized.current) { setSource(defaultGenerationSource(state)); if(state.generationSource?.model) setModel(state.generationSource.model); }
    if (pendingRestoreMotion.current) {
      pendingRestoreMotion.current = false;
      setRestoreMotionRevision(value => value + 1);
    }
    if (pendingInsertionMotion.current) {
      pendingInsertionMotion.current = false;
      setInsertionMotionRevision(value => value + 1);
    }
    setHealthNow(Date.now());
    setData(state);
    if (initialJob && !initialJobOpened.current) {
      setSelected(state.jobs.find((job: Job) => job.id === initialJob) ?? null);
      initialJobOpened.current = true;
    }
    if (state.cloud) setSource("api");
    if (!poolInitialized.current) {
      setPoolDraft(state.pool);
      setQueueDirectory(state.paths?.queueDirectory ?? "");
      setReferenceDirectories(
        state.paths?.referenceDirectories.join("\n") ?? "",
      );
      poolInitialized.current = true;
    }
    setLoaded(true);
    return state as State;
  }, [initialJob]);
  useEffect(() => {
    if (!initialState) refresh().catch((e) => setNotice(e.message));
  }, [initialState, refresh]);
  // Cards the operation will move leave as soon as their exit fade ends, inside the click's input window, so the
  // neighbours closing in never counts as a layout shift. The server reply and the refresh only confirm it; anything
  // the server did not move comes back with the refreshed state.
  const retainCards = useCallback(async (ids: string[], operation: "archive" | "trash" | "restore", includeStack: boolean, onLeave?: () => void) => {
    const leaving = retentionSelection(data.jobs, ids, includeStack).eligible.map(job => job.id);
    const request = retentionAction({ids, operation, includeStack});
    request.catch(() => {}); // Awaited below, after the fade; this only keeps an early rejection from reporting as unhandled.
    const clearExit = await animateRetainedCards(leaving);
    if (leaving.length) {
      setRemovalMotionRevision(value => value + 1);
      setLeavingIds(current => new Set([...current, ...leaving]));
    }
    onLeave?.();
    try {
      const result = await request;
      const state = await refresh();
      return {result, state};
    } finally {
      clearExit();
      if (leaving.length) setLeavingIds(current => new Set([...current].filter(id => !leaving.includes(id))));
    }
  }, [data.jobs, refresh]);
  useEffect(() => {
    setSelected(current => {
      if (!current || !["queued", "running"].includes(current.status)) return current;
      return data.jobs.find(job => job.id === current.id) ?? current;
    });
  }, [data.jobs]);
  const pendingGenerationIds = useRef(new Set<string>());
  const [readySinceOpening, setReadySinceOpening] = useState(0);
  useEffect(() => {
    const completed = data.jobs.filter(job =>
      job.status === "done" && pendingGenerationIds.current.has(job.id),
    ).length;
    pendingGenerationIds.current = new Set(data.jobs
      .filter(job => job.status === "queued" || job.status === "running")
      .map(job => job.id));
    if (completed > 0) {
      setReadySinceOpening(count => count + completed);
    }
  }, [data.jobs]);
  const active = data.jobs.some((j) =>
    ["queued", "running"].includes(j.status),
  );
  useEffect(() => {
    const id = setInterval(
      () => {
        refresh().catch(() => {});
      },
      active ? 5000 : 30000,
    );
    return () => clearInterval(id);
  }, [active, refresh]);
  useEffect(() => {
    try {
      setDark(window.localStorage.getItem("image-queue-theme") !== "light");
    } catch {
      // The theme can still be changed when browser storage is unavailable.
    }
  }, []);
  useEffect(() => {
    try {
      const saved = readCustomSizes(window.localStorage.getItem(customSizesStorageKey));
      setSavedCustomSizes(saved.sizes);
      if (saved.selected) { setSize(saved.selected); setCustomDimensionsSelected(saved.sizes.includes(saved.selected)); }
    } catch { /* Browser storage may be disabled. */ }
    setCustomSizesLoaded(true);
  }, []);
  useEffect(() => {
    if (!customSizesLoaded) return;
    try { window.localStorage.setItem(customSizesStorageKey, JSON.stringify({ sizes: savedCustomSizes, selected: size })); }
    catch { /* The current form remains usable without persistence. */ }
  }, [savedCustomSizes, size, customSizesLoaded]);
  useLayoutEffect(() => applyTheme(dark ? "dark" : "light"), [dark]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.key === "n" &&
        !selected && !e.metaKey && !e.ctrlKey && !e.altKey &&
        !(e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)))
      ) {
        e.preventDefault();
        setComposerCollapsed(false);
        requestAnimationFrame(() => promptInput.current?.focus());
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [selected]);
  const activeJobs = useMemo(() => visibleJobs(data.jobs), [data.jobs]);
  const viewJobs = useMemo(() => (retentionView === "active" && search
    ? data.jobs.filter(job => !job.trashedAt)
    : visibleJobs(data.jobs, retentionView)).filter(job => !leavingIds.has(job.id)), [data.jobs, retentionView, search, leavingIds]);
  const currentProject = data.projects.find((p) => p.id === project);
  const currentTopic = data.topics?.find((item) => item.id === topic);
  const hasSearch = Boolean(search.trim());
  const searchIndex = useMemo(
    () => hasSearch ? new ImageIndex(data.jobs, data.projects, data.topics ?? []) : null,
    [hasSearch, data.jobs, data.projects, data.topics],
  );
  const searchableIds = useMemo(() => new Set(data.jobs.map(job => job.id)), [data.jobs]);
  const matchingIds = useMemo(
    () => searchIndex?.search(search) ?? searchableIds,
    [searchIndex, search, searchableIds],
  );
  const queueCounts = useMemo(() => {
    const requests = activeJobs.filter(job =>
      ["queued", "running"].includes(job.status) && matchingIds.has(job.id) &&
      (!tagFilter || job.tags?.some(item => item.tag === tagFilter))
    );
    return {
      all: requests.length,
      queued: requests.filter(job => job.status === "queued").length,
      reserved: requests.filter(isReserved).length,
      running: requests.filter(job => job.status === "running" && !isReserved(job)).length,
    };
  }, [activeJobs, matchingIds, tagFilter]);
  const jobs = useMemo(
    () =>
      viewJobs.filter(
        (j) =>
          (!queuePage || ["queued", "running"].includes(j.status)) &&
          (project === "all" || j.projectId === project) &&
          (!topic || j.topicId === topic) &&
          (filter === "all" ||
            (filter === "active"
              ? ["queued", "running"].includes(j.status)
              : filter === "reserved"
                ? isReserved(j)
                : j.status === filter && (!(queuePage && filter === "running") || !isReserved(j)))) &&
          matchingIds.has(j.id) &&
          (!tagFilter || j.tags?.some((item) => item.tag === tagFilter)),
      ),
    [viewJobs, project, topic, filter, matchingIds, tagFilter, queuePage],
  );
  useEffect(() => {
    const visibleIds = new Set(jobs.map(job => job.id));
    setSelectedIds(previous => {
      const retained = previous.filter(id => visibleIds.has(id));
      return retained.length === previous.length ? previous : retained;
    });
  }, [jobs]);
  useLayoutEffect(() => {
    if (settingsPage) return;
    const selectAll = (event: KeyboardEvent) => {
      const target = event.target;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return;
      if (event.key === "Escape") {
        setSelectedIds([]);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "a") return;
      event.preventDefault();
      setSelectedIds((stacked ? stackedImages(jobs) : jobs).map(job => job.id));
    };
    window.addEventListener("keydown", selectAll);
    return () => window.removeEventListener("keydown", selectAll);
  }, [jobs, stacked, settingsPage]);
  const availableTags = useMemo(() => tagCounts(viewJobs.filter(job =>
    (project === "all" || job.projectId === project) && (!topic || job.topicId === topic)
  )), [viewJobs, project, topic]);
  const projectId = data.projects.some(item => item.id === destination)
    ? destination
    : currentProject?.id || data.projects[0]?.id;
  useEffect(() => {
    if (destinationTopic && !data.topics?.some(item => item.id === destinationTopic && item.projectId === projectId && !item.deleted)) {
      setDestinationTopic("");
    }
  }, [destinationTopic, projectId, data.topics]);
  const detailVersions = useMemo(() => selected?.stackId
    ? orderedVersions(viewJobs.filter(job => job.stackId === selected.stackId))
    : [], [selected?.stackId, viewJobs]);
  const nextVersionNumber = selected?.stackId
    ? Math.max(
        data.stackCounters?.find(counter => counter.id === selected.stackId)?.lastVersion ?? 0,
        data.jobs.filter(job => job.stackId === selected.stackId).length,
        ...data.jobs.filter(job => job.stackId === selected.stackId).map(job => job.versionNumber ?? 0),
      ) + 1
    : 2;
  const detailVersionIndex = detailVersions.findIndex(job => job.id === selected?.id);
  const detailSequence = stacked ? stackedImages(jobs) : jobs;
  const stackCandidates = useMemo(() => stackedImages(activeJobs).filter(job =>
    job.id !== selected?.id && job.status === "done" &&
    job.projectId === selected?.projectId && job.topicId === selected?.topicId &&
    `${job.originalName ?? ""} ${job.prompt} ${job.id}`.toLowerCase().includes(stackSearch.trim().toLowerCase())
  ), [activeJobs, selected?.id, selected?.projectId, selected?.topicId, stackSearch]);
  const detailIndex = detailSequence.findIndex((job) => job.id === selected?.id || Boolean(stacked && selected?.stackId && job.stackId === selected.stackId));
  const previousImage = detailSequence[detailIndex - 1];
  const nextImage = detailSequence[detailIndex + 1];
  const retainDetail = useCallback(async (job: Job, operation: "archive" | "trash") => {
    try {
      const {result, state} = await retainCards([job.id], operation, false);
      showError(result);
      if (result?.data?.undoId) setUndoHistory(history => [...history, result.data!.undoId]);
      setSelected(current => current?.id === job.id
        ? result?.data?.changed.includes(job.id) ? null : state.jobs.find(candidate => candidate.id === job.id) ?? null
        : current);
      showRetentionNotice(result?.data?.changed.includes(job.id)
        ? operation === "archive" ? "Image archived" : "Image moved to trash"
        : "This request is active and cannot be moved yet", Boolean(result?.data?.undoId));
    } catch (error) { setNotice((error as Error).message); }
  }, [retainCards, showRetentionNotice]);
  useEffect(() => {
    if (!selected || stackPicker) return;
    const navigate = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role=combobox], [role=menu], [role=listbox]"))) return;
      if (!event.defaultPrevented && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey &&
          !selected.trashedAt && !["queued", "running"].includes(selected.status)) {
        const operation = event.key === "Delete" ? "trash" : event.key.toLowerCase() === "e" && !selected.archivedAt ? "archive" : undefined;
        if (operation) {
          event.preventDefault();
          void retainDetail(selected, operation);
          return;
        }
      }
      if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();nextVersionInput.current?.focus();return;
      }
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const next = event.key === "ArrowUp"
        ? detailVersions[detailVersionIndex - 1]
        : event.key === "ArrowDown"
          ? detailVersions[detailVersionIndex + 1]
          : event.key === "ArrowRight" ? nextImage : previousImage;
      if (next) {
        event.preventDefault();
        setSelected(next);
      }
    };
    window.addEventListener("keydown", navigate, true);
    return () => window.removeEventListener("keydown", navigate, true);
  }, [selected, previousImage, nextImage, detailVersions, detailVersionIndex, stackPicker, retainDetail]);
  const galleryScope = viewJobs.filter(job =>
    (project === "all" || job.projectId === project) &&
    (!topic || job.topicId === topic),
  );
  const counts = jobCounts(galleryScope.filter(job =>
    matchingIds.has(job.id) &&
    (!tagFilter || job.tags?.some(item => item.tag === tagFilter)),
  ));
  const showFilterRow = selectedIds.length === 0 &&
    !settingsPage && retentionView === "active" &&
    (queuePage ? active : galleryScope.length > 0);
  useEffect(() => {
    if (!showFilterRow) return;
    const row = filterRow.current;
    if (!row) return;
    const observer = new ResizeObserver(measureFilters);
    observer.observe(row);
    for (const button of row.children) observer.observe(button);
    window.addEventListener("resize", measureFilters);
    measureFilters();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureFilters);
    };
  }, [measureFilters, queuePage, showFilterRow]);
  const [reservationReviewId,setReservationReviewId]=useState<string>();
  const health = data.localRunner ? (data.localRunner.paused ? "Workers paused" : data.localRunner.blockedReason ? "Local execution needs attention" : data.localRunner.enabled === 0 ? "Workers paused" : data.localRunner.running ? `${data.localRunner.running} generating` : "Ready for requests") : workerHealth(data.pool, data.pulses, healthNow);
  const stoppedJob = data.localRunner?.blockedJobId ? data.jobs.find(job => job.id === data.localRunner?.blockedJobId) : undefined;
  const workersPaused = data.localRunner ? (data.localRunner.paused ?? data.localRunner.enabled === 0) : data.pool.workers === 0;
  const slotsWithoutHeartbeat = Array.from({ length: data.pool.workers }, (_, index) => index + 1)
    .filter(slot => !data.pulses.some(pulse => pulse.slot === slot)).length;
  const queueWaitState = { paused: workersPaused, blockedReason: data.localRunner?.blockedReason, resumesAutomatically: Boolean(data.localRunner?.resumeAt), notResponding: health === "Workers not responding" };
  const queueRequestsNotice = queueWaitNotice(queueWaitState);
  const queueVersionNotice = queueWaitNotice(queueWaitState, "version");
  const workersUnavailable = queueRequestsNotice !== undefined;
  const connectedProviders = [
    ...new Set(data.models.filter(entry => entry.provider === "openai").map((entry) => entry.provider)),
  ];
  useEffect(() => {
    if (!settingsPage && connectedProviders.length && !connectedProviders.includes(provider)) {
      setProvider(connectedProviders[0]);
      setModel("");
    }
  }, [data.models, provider, settingsPage]);
  const models = modelsWithSizeProfiles(data.models).filter((m) => m.provider === "openai");
  useEffect(() => {
    if (source !== "api") return;
    const compatible = models.filter(entry => refs.length === 0 || entry.references);
    if (compatible.some(entry => entry.id === model)) return;
    setModel(compatible[0]?.id ?? "");
    setResolution("");
  }, [source, data.models, model, refs.length]);
  const selectedSizeProfile = models.find(entry => entry.id === model)?.sizeProfile;
  const resolutionLevels = source === "api" && provider === "google" && selectedSizeProfile?.mode === "aspect-ratio"
    ? selectedSizeProfile.levels.filter(level => ["512", "1K", "2K", "4K"].includes(level))
    : [];
  const selectedResolution = resolutionLevels.includes(resolution)
    ? resolution as "512" | "1K" | "2K" | "4K"
    : undefined;
  const supportsCustomSize = source === "queue" || Boolean(selectedSizeProfile);
  const sizeAdaptation = useMemo(() => {
    if (source !== "api" || !selectedSizeProfile) return null;
    const [width, height] = size.split("x").map(Number);
    try {
      const resolved = resolveModelSize(selectedSizeProfile, { width, height });
      return resolved.requiresResize && resolved.parameters.size
        ? `Output will be center-cropped or resized from ${resolved.parameters.size.replace("x", " × ")} to ${width} × ${height}.`
        : null;
    } catch { return null; }
  }, [source, selectedSizeProfile, size]);
  const unavailableSizeMessage = supportsCustomSize
    ? "Choose Custom size to enter dimensions supported by this model."
    : "This model has no supported image sizes configured.";
  const sizes = useMemo(
    () =>
      source === "queue"
        ? [...new Set([...queueSizes, ...savedCustomSizes, size])]
        : (() => {
          const options = [...new Set([...modelSizes(provider, model, selectedSizeProfile), ...savedCustomSizes.filter(value => {
            if (!selectedSizeProfile) return false;
            const [width, height] = value.split("x").map(Number);
            try { resolveModelSize(selectedSizeProfile, { width, height }); return true; } catch { return false; }
          })])];
          if (selectedSizeProfile) {
            const [width, height] = size.split("x").map(Number);
            if (!customDimensionsSelected && selectedSizeProfile.mode === "fixed" &&
              selectedSizeProfile.sizes.some(native => native.width * height === native.height * width))
              return options;
            try {
              resolveModelSize(selectedSizeProfile, { width, height });
              return [...new Set([...options, size])];
            } catch { return options; }
          }
          return options;
        })(),
    [source, provider, model, data.models, size, customDimensionsSelected, savedCustomSizes],
  );
  useEffect(() => {
    if (!loaded || !customSizesLoaded || !sizes.length || sizes.includes(size)) return;
    const replacement = closestAspectSize(size, sizes);
    const [width, height] = size.split("x").map(Number);
    const [nextWidth, nextHeight] = replacement.split("x").map(Number);
    if (customDimensionsSelected || width * nextHeight !== height * nextWidth)
      setSizeFallback({ before: size, after: replacement });
    else setSizeFallback(null);
    setCustomDimensionsSelected(false);
    setSize(replacement);
  }, [sizes, size, customDimensionsSelected, loaded, customSizesLoaded]);
  const selectedModel = models.find((item) => item.id === model);
  const correctionNeedsConnection = source === "api" && models.length === 0;
  const correctionSourceError = source === "api"
    ? !selectedModel ? "Connect OpenAI in Settings and choose an image model."
      : !selectedModel.references ? "Choose a model that supports reference images."
      : detailJob?.transparent && (!detailJob.imported || detailJob.opacityVerified) && !selectedModel.transparency
        ? "This image has transparency. Choose a source that supports transparent images."
      : ""
    : "";
  const transparencyAllowed =
    source === "queue" || selectedModel?.transparency === true;
  useEffect(() => {
    if (!transparencyAllowed) setTransparent(false);
  }, [transparencyAllowed]);
  const referencesById = useMemo(() => new Map(data.references.map(reference => [reference.id, reference])), [data.references]);
  const selectedRefs = refs.flatMap(id => {
    const reference = referencesById.get(id);
    return reference ? [reference] : [];
  });
  useLayoutEffect(() => {
    const changedSource = priorComposerSource.current !== source;
    priorComposerSource.current = source;
    const element = composerSurface.current;
    if (!element) return;
    const previous = composerHeight.current;
    composerHeight.current = element.getBoundingClientRect().height;
    if (changedSource) return;
    return animateHeightChange(element, previous);
  }, [composerExpanded, composerCollapsed, source, loaded, selectedRefs.length]);

  const showError = (
    result: { serverError?: string; validationErrors?: unknown } | undefined,
  ) => {
    if (result?.serverError || result?.validationErrors)
      throw new Error(result.serverError ?? "Please check the form fields");
  };
  const changeDefaultSource = async (next: "queue" | "api", nextModel?: string) => {
    if (sourceSavePending.current) return;
    sourceSavePending.current = true;
    const previous = source;
    const previousModel = model;
    setSavingSource(true);
    setSource(next);
    if (nextModel) setModel(nextModel);
    try {
      const result = await generationSourceAction({ source: next, provider: "openai", ...(nextModel ? { model: nextModel } : {}) });
      showError(result);
      if (result?.data) {
        setData(current => ({ ...current, generationSource: result.data }));
        if (result.data.model) setModel(result.data.model);
      }
      setNotice("Default source saved. Existing requests keep their source.");
    } catch (error) {
      setSource(previous);
      setModel(previousModel);
      setNotice((error as Error).message);
    } finally {
      sourceSavePending.current = false;
      setSavingSource(false);
    }
  };
  const undoLastRetention = useCallback(async () => {
    if (!undoId || undoPending.current) return;
    undoPending.current = true;
    setUndoBusy(true);
    try {
      showError(await undoRetentionAction({id:undoId}));
      setUndoHistory(history => history.filter(id => id !== undoId));
      // Earlier retention actions stay undoable from this notice.
      showRetentionNotice("Action undone", true);
      pendingRestoreMotion.current = true;
      await refresh();
    } catch (error) {setNotice((error as Error).message);}
    finally {undoPending.current = false; setUndoBusy(false);}
  }, [undoId, refresh, showRetentionNotice]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT","TEXTAREA","SELECT"].includes(target.tagName))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey && undoId) {
        event.preventDefault(); void undoLastRetention();
      }
    };
    window.addEventListener("keydown",listener);
    return () => window.removeEventListener("keydown",listener);
  }, [undoId, undoLastRetention]);
  const [pickingDirectory, setPickingDirectory] = useState<"queue" | "reference" | "project" | null>(null);
  const directoryPickerPending = useRef(false);
  async function chooseDirectory(kind: "queue" | "reference" | "project") {
    if (directoryPickerPending.current) return;
    directoryPickerPending.current = true;
    setPickingDirectory(kind);
    try {
      const response = await fetch("/api/directory-picker", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!result.path) return;
      if (kind === "project") setProjectDirectory(result.path);
      else if (kind === "queue") setQueueDirectory(result.path);
      else setReferenceDirectories(current => {
        const paths = current.split("\n").map(value => value.trim()).filter(Boolean);
        const selected = result.path.replace(/\/$/, "") || "/";
        if (paths.some(value => (value.replace(/\/$/, "") || "/") === selected)) return current;
        return [...paths, result.path].join("\n");
      });
    } catch (error) { setNotice((error as Error).message); }
    finally { directoryPickerPending.current = false; setPickingDirectory(null); }
  }
  const [pendingConfirmation, setPendingConfirmation] = useState<{ ids: string[]; message: string } | null>(null);
  useEffect(() => {
    if (!pendingConfirmation) return;
    setPendingConfirmation(null);
    const main = workspaceMain.current;
    if (main && anyTileVisible(main, pendingConfirmation.ids, galleryVisibleArea(main))) return;
    setNotice(pendingConfirmation.message);
  }, [pendingConfirmation]);
  const requestInFlight = useRef(false);
  async function submit(values: z.infer<typeof formSchema>) {
    if (requestInFlight.current) return;
    if (!projectId) {
      setNewProject(true);
      return;
    }
    if (source === "api" && !sizes.length) {
      setNotice(unavailableSizeMessage);
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const [width, height] = size.split("x").map(Number);
      const created: string[] = [];
      for (let variant = 0; variant < Number(variants); variant++) {
        const result = await requestImageAction({
          ...values,
          projectId,
          topicId: destinationTopic || undefined,
          source,
          provider,
          model,
          resolution: selectedResolution,
          exactDimensions: selectedResolution && !customDimensionsSelected ? false : undefined,
          aspectRatio: aspectRatios.find(value => {
            const [ratioWidth, ratioHeight] = value.split(":").map(Number);
            return width * ratioHeight === height * ratioWidth;
          }),
          width,
          height,
          transparent,
          referenceIds: refs,
          idempotencyKey: `${requestKey.current}-${variant}`,
        });
        showError(result);
        if (result?.data?.id) created.push(result.data.id);
      }
      requestKey.current = crypto.randomUUID();
      if (form.getValues("prompt") === values.prompt) form.reset();
      setRefs(current => current.filter(id => !refs.includes(id)));
      const confirmation = source === "queue" ? "Added to the Codex queue" : "Generation started";
      pendingInsertionMotion.current = true;
      try {
        await refresh();
        // Checked once after the refreshed gallery commits; a visible new tile is its own confirmation.
        setPendingConfirmation({ ids: created, message: confirmation });
      } catch {
        setNotice(`${confirmation}. Could not refresh the workspace.`);
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }
  async function upload(file: File, parentId?: string, timestampMs?: number, targetProjectId = projectId) {
    if (!targetProjectId) {
      setNewProject(true);
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("projectId", targetProjectId);
    if (parentId) body.set("parentId", parentId);
    if (timestampMs !== undefined) body.set("timestampMs", String(timestampMs));
    const response = await fetch("/api/upload", { method: "POST", body });
    const reference = await response.json();
    if (!response.ok) throw new Error(reference.error ?? "Upload failed");
    await refresh();
    setRefs((previous) => [...previous, reference.id]);
  }
  async function uploadJobReference(job: Job, targetProjectId = projectId) {
    const result = await fetch(asset(job, false));
    if (!result.ok) throw new Error("Could not load image reference");
    const blob = await result.blob();
    await upload(new File([blob], job.originalName || `${job.id}.png`, { type: blob.type }), undefined, undefined, targetProjectId);
  }

  async function attachReferences(jobs: Job[], files: File[], targetProjectId: string) {
    setComposerCollapsed(false);
    setSelectedIds([]);
    for (const job of jobs) await uploadJobReference(job, targetProjectId);
    for (const file of files) await upload(file, undefined, undefined, targetProjectId);
    setNotice("");
    if (!library) promptInput.current?.focus();
  }

  async function receiveReferences(jobs: Job[], files: File[]) {
    if (jobs.length + files.length === 0) throw new Error("Select a completed image to add as a reference");
    if (files.some(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type)))
      throw new Error("References support PNG, JPEG and WebP images");
    const referenceCount = refs.length + jobs.length + files.length;
    if (referenceCount > 10) throw new Error("You can add up to 10 image references");
    if (!projectId) {
      pendingReferenceDrop.current = { jobs, files };
      setLibrary(false);
      setNewProject(true);
      return;
    }
    await attachReferences(jobs, files, projectId);
  }

  const referenceDropHandlers = {
    async onPaste(event: React.ClipboardEvent) {
      const files = Array.from(event.clipboardData.files)
        .filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        await receiveReferences([], files);
      } catch (error) {
        setNotice((error as Error).message);
      }
    },
    onDragOver(event: React.DragEvent) {
      if (!event.dataTransfer.types.some(type => type === "Files" || type === "application/x-image-queue-jobs")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      event.currentTarget.setAttribute("data-reference-drop", "");
    },
    onDragLeave(event: React.DragEvent) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      event.currentTarget.removeAttribute("data-reference-drop");
    },
    async onDrop(event: React.DragEvent) {
      event.currentTarget.removeAttribute("data-reference-drop");
      const raw = event.dataTransfer.getData("application/x-image-queue-jobs");
      // A browser image drag may include a native file alongside our gallery payload.
      const files = raw ? [] : Array.from(event.dataTransfer.files);
      if (!raw && files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        const ids: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("Invalid image selection");
        const jobsById = new Map(data.jobs.map(job => [job.id, job]));
        const jobs = [...new Set<string>(ids)].flatMap(id => {
          const job = jobsById.get(id);
          return job?.status === "done" ? [job] : [];
        });
        await receiveReferences(jobs, files);
      } catch (error) {
        setNotice((error as Error).message);
      }
    },
  };
  async function updateLibraryTag(to?: string) {
    if (libraryTagPending.current) return;
    libraryTagPending.current = true;
    setSavingLibraryTag(true);
    try {
      showError(await editTagAction({ from: tagFrom, ...(to === undefined ? {} : { to }) }));
      setTagFrom("");
      setTagTo("");
      const message = to === undefined ? "Tag removed from the library" : "Tag updated across the library";
      try {
        await refresh();
        setNotice(message);
      } catch {
        setNotice(`${message}. Refresh the page to update the workspace.`);
      }
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      libraryTagPending.current = false;
      setSavingLibraryTag(false);
    }
  }

  async function saveImageNote(job: Job) {
    const draft = iterationPrompt;
    if (noteSavePending.current || !draft.trim() || draft.trim().length > 4000) return;
    noteSavePending.current = true;
    setSavingNote(true);
    const point = notePoint;
    try {
      showError(await addNoteAction({ imageId: job.id, text: draft, ...point }));
      setIterationPrompt(current => current === draft ? "" : current);
      setNotePoint(current => current === point ? undefined : current);
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      noteSavePending.current = false;
      setSavingNote(false);
    }
  }

  async function requestCorrection(job: Job, instruction = "") {
    if (busy || correctionPending.current || job.status !== "done" || job.archivedAt || job.trashedAt) return;
    if (correctionSourceError) { setNotice(correctionSourceError); return; }
    const notes = (data.notes ?? []).filter(
      (note) => note.imageId === job.id && !note.sentInJobId,
    );
    if (!notes.length && !instruction.trim()) return;
    const generationSignature = JSON.stringify({ source, provider, model });
    const notesSignature = JSON.stringify(notes.map(({ id, text, x, y, w, h }) => ({ id, text, x, y, w, h })));
    correctionPending.current = true;
    setBusy(true);
    try {
      const response = await fetch(asset(job, false));
      if (!response.ok) throw new Error("Could not load original image");
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        throw new Error("Canvas unavailable");
      }
      try {
        context.drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }
      notes.forEach((note, index) => {
        if (note.x === undefined || note.y === undefined) return;
        const x = note.x * canvas.width,
          y = note.y * canvas.height;
        if (note.w && note.h) {
          context.strokeStyle = "#5f5ce6";
          context.lineWidth = 4;
          context.strokeRect(
            x,
            y,
            note.w * canvas.width,
            note.h * canvas.height,
          );
        }
        context.fillStyle = "#5f5ce6";
        context.beginPath();
        context.arc(x, y, 24, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#fff";
        context.font = "bold 24px sans-serif";
        context.fillText(String(index + 1), x - 7, y + 8);
      });
      const annotated = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!annotated) throw new Error("Could not create annotated reference");
      const pending =
        correctionRequest.current?.imageId === job.id && correctionRequest.current.instruction === instruction && correctionRequest.current.notesSignature === notesSignature && correctionRequest.current.generationSignature === generationSignature
          ? correctionRequest.current
          : { imageId: job.id, instruction, notesSignature, generationSignature, key: crypto.randomUUID(), referenceIds: [] };
      correctionRequest.current = pending;
      const referenceIds = pending.referenceIds;
      for (const [index, [file, name]] of (
        [
          [blob, "original.png"],
          [annotated, "notes.png"],
        ] as const
      ).entries()) {
        if (referenceIds[index]) continue;
        const body = new FormData();
        body.set("file", new File([file], name, { type: file.type }));
        body.set("projectId", job.projectId);
        const uploaded = await fetch("/api/upload", { method: "POST", body });
        const reference = await uploaded.json();
        if (!uploaded.ok) throw new Error(reference.error);
        referenceIds.push(reference.id);
      }
      const result = await correctionAction({
        imageId: job.id,
        referenceIds,
        idempotencyKey: pending.key,
        instruction: pending.instruction,
        generation: { source, provider, model },
      });
      showError(result);
      correctionRequest.current = null;
      setIterationPrompt("");
      await refresh();
      setNotice(source === "queue" ? "Correction added to queue" : "Image correction started");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      correctionPending.current = false;
      setBusy(false);
    }
  }
  function isLowerHalf(event: React.DragEvent) {
    const row = event.currentTarget.getBoundingClientRect();
    return event.clientY >= row.top + row.height / 2;
  }
  function navigationTargetProps(collection: "projects" | "topics" | "pins", id: string) {
    const key = `${collection}:${id}`;
    return {
      "data-drop-position": navigationTarget?.key === key ? navigationTarget.kind : undefined,
      onDragOver(event: React.DragEvent<HTMLButtonElement>) {
        const source = draggedNavigation.current;
        const jobs = event.dataTransfer.types.includes("application/x-image-queue-jobs");
        const before = source?.collection === collection && source.id !== id;
        const receive = (jobs && collection !== "pins") ||
          (source?.collection === "topics" && collection === "projects") ||
          (collection === "pins" && (source?.collection === "projects" || source?.collection === "topics"));
        if (!before && !receive) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const kind = before ? (isLowerHalf(event) ? "after" : "before") : "receive";
        setNavigationTarget(current => current?.key === key && current.kind === kind ? current : { key, kind });
      },
      onDragLeave(event: React.DragEvent<HTMLButtonElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setNavigationTarget(current => current?.key === key ? null : current);
      },
    };
  }
  function navigationDrag(
    event: React.DragEvent,
    collection: "projects" | "topics" | "pins",
    id: string,
  ) {
    draggedNavigation.current = { collection, id };
    event.dataTransfer.setData(
      "application/x-image-queue-navigation",
      JSON.stringify({ collection, id }),
    );
    event.dataTransfer.effectAllowed = "move";
  }
  async function navigationDrop(
    event: React.DragEvent,
    collection: "projects" | "topics" | "pins",
    beforeId: string,
  ) {
    const raw = event.dataTransfer.getData(
      "application/x-image-queue-navigation",
    );
    if (!raw) return false;
    event.preventDefault();
    const before = navigationPositions();
    try {
      const item = JSON.parse(raw);
      if (item.collection === collection)
        showError(
          await placeBeforeAction({ collection, id: item.id, beforeId, afterTarget: isLowerHalf(event) }),
        );
      else if (item.collection === "topics" && collection === "projects")
        showError(await moveTopicAction({ id: item.id, projectId: beforeId }));
      else if (
        collection === "pins" &&
        ["projects", "topics"].includes(item.collection)
      )
        showError(
          await pinAction({
            targetType: item.collection === "projects" ? "project" : "topic",
            targetId: item.id,
            pinned: true,
          }),
        );
      pendingNavigationMotion.current = before;
      await refresh();
    } catch (error) {
      pendingNavigationMotion.current = null;
      setNotice((error as Error).message);
    }
    return true;
  }
  function importImages(files: FileList | File[]) {
    const batch = Array.from(files);
    const destination = project === "all" ? "inbox" : project;
    pendingImport.current = pendingImport.current.then(async () => {
      const messages: string[] = [];
      for (const file of batch) {
        const body = new FormData();
        body.set("file", file);
        body.set("projectId", destination);
        try {
          const response = await fetch("/api/import", { method: "POST", body });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Import failed");
          const existingProjectId = result.job?.projectId;
          const location = existingProjectId === "inbox"
            ? "Inbox"
            : data.projects.find((item) => item.id === existingProjectId)?.name;
          const status = result.duplicate
            ? location ? `already imported in ${location}` : "already imported"
            : "imported";
          messages.push(`${file.name}: ${status}`);
        } catch (error) {
          messages.push(`${file.name}: ${(error as Error).message}`);
        }
      }
      await refresh();
      setNotice(messages.join(" · "));
    }).catch(error => {
      setNotice(error instanceof Error ? error.message : "Import failed");
    });
  }
  return (
    <TooltipProvider>
    <div
      ref={workspaceRoot}
      className={`workspace ${mobileMenu ? "mobile-menu-open" : ""} ${composerExpanded ? "composer-expanded" : ""}`}
    >
      <Button
        ref={navigationToggle}
        className="mobile-menu-toggle"
        variant="outline"
        aria-label="Toggle navigation"
        aria-expanded={mobileMenu}
        onClick={() => setMobileMenu((value) => !value)}
      >
        <Layers3 size={18} />
      </Button>
      <aside className="sidebar"
        onDragEnd={() => { draggedNavigation.current = null; setNavigationTarget(null); }}
        onDropCapture={() => { draggedNavigation.current = null; setNavigationTarget(null); }}
      >
        <a className="brand" href="/">
          <span className="brand-mark">
            <Slideshow size={21} />
          </span>
          <span>
            image<span className="brand-light">-queue</span>
          </span>
        </a>
        <div className="workspace-label">
          Your workspace <span className="local-dot">{data.cloud ? "Cloudflare" : "Local"}</span>
        </div>
        <Button
          variant="ghost"
          className={`nav-item ${project === "all" && retentionView === "active" && !settingsPage && !queuePage ? "selected" : ""}`}
          aria-current={project === "all" && retentionView === "active" && !settingsPage && !queuePage ? "page" : undefined}
          onClick={() => navigateProject("all")}
        >
          <LayoutGrid size={17} /> All images <ChangingLabel value={String(activeJobs.length)} />
        </Button>
        <Button
          variant="ghost"
          className={`nav-item ${project === "inbox" ? "selected" : ""}`}
          aria-current={!settingsPage && project === "inbox" ? "page" : undefined}
          onClick={() => {
            navigateProject("inbox");
            setFilter("all");
          }}
        >
          <Inbox size={17} /> Inbox{" "}
          <ChangingLabel value={String(activeJobs.filter(job => job.projectId === "inbox").length)} />
        </Button>
        <Button
          variant="ghost"
          className={`nav-item ${queuePage ? "selected" : ""}`}
          aria-current={!settingsPage && queuePage ? "page" : undefined}
          onClick={() => {
            if (settingsPage) {
              router.push("/?view=queue");
              return;
            }
            window.history.replaceState({}, "", "/?view=queue");
            setRetentionView("active");
            setQueuePage(true);
            setTopic("");
            setTagFilter("");
            setSearch("");
            setFilter("all");
            setProject("all");
          }}
        >
          <Clock3 size={17} /> Queue{" "}
          <ChangingLabel value={String(data.jobs.filter(j => ["running", "queued"].includes(j.status)).length)} />
        </Button>
        {data.projects.some(project => project.id !== "inbox") && <Button variant="ghost" className="nav-item section-label section-toggle" aria-expanded={projectsExpanded} aria-controls="sidebar-projects" onClick={() => setProjectsExpanded(value => !value)}>Projects<span aria-hidden="true">{projectsExpanded ? "−" : "+"}</span></Button>}
        <div
          className="pinned-nav"
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes(
                "application/x-image-queue-navigation",
              )
            )
              event.preventDefault();
          }}
          onDrop={async (event) => {
            if (event.target !== event.currentTarget) return;
            const raw = event.dataTransfer.getData(
              "application/x-image-queue-navigation",
            );
            if (!raw) return;
            event.preventDefault();
            try {
              const item = JSON.parse(raw);
              if (["projects", "topics"].includes(item.collection)) {
                showError(
                  await pinAction({
                    targetType:
                      item.collection === "projects" ? "project" : "topic",
                    targetId: item.id,
                    pinned: true,
                  }),
                );
                await refresh();
              }
            } catch (error) {
              setNotice((error as Error).message);
            }
          }}
        >
          {data.pins?.some(pin => pin.targetType === "project"
            ? data.projects.some(project => project.id === pin.targetId)
            : data.topics?.some(topic => topic.id === pin.targetId)) && <Button variant="ghost" className="nav-item section-label section-toggle" aria-expanded={pinsExpanded} aria-controls="sidebar-pins" onClick={() => setPinsExpanded(value => !value)}>Pinned<span aria-hidden="true">{pinsExpanded ? "−" : "+"}</span></Button>}
          <div id="sidebar-pins" className="navigation-collapse" data-expanded={pinsExpanded} inert={!pinsExpanded}><div>
          {data.pins
            ?.slice()
            .sort((a, b) => a.order - b.order)
            .map((pin) => {
              const target =
                pin.targetType === "project"
                  ? data.projects.find((p) => p.id === pin.targetId)
                  : data.topics?.find((t) => t.id === pin.targetId);
              return (
                target && (
                  <Button
                    key={pin.id}
                    data-navigation-id={`pins:${pin.id}`}
                    draggable
                    onDragStart={(event) =>
                      navigationDrag(event, "pins", pin.id)
                    }
                    {...navigationTargetProps("pins", pin.id)}
                    onDrop={(event) =>
                      void navigationDrop(event, "pins", pin.id)
                    }
                    onKeyDown={async (event) => {
                      if (
                        event.altKey &&
                        ["ArrowUp", "ArrowDown"].includes(event.key)
                      ) {
                        event.preventDefault();
                        showError(
                          await reorderAction({
                            collection: "pins",
                            id: pin.id,
                            direction: event.key === "ArrowUp" ? -1 : 1,
                          }),
                        );
                        await refresh();
                      }
                    }}
                    variant="ghost"
                    className="nav-item"
                    onClick={() => {
                      navigateProject(
                        pin.targetType === "topic"
                          ? (target as import("@/core/organization").Topic)
                              .projectId
                          : target.id,
                      );
                      if (pin.targetType === "topic") setTopic(pin.targetId);
                    }}
                  >
                    {pin.targetType === "project" ? <Folder size={16} /> : <Layers3 size={16} />}
                    <span className="project-name">{target.name}</span>
                    <span>{activeJobs.filter(job => pin.targetType === "project"
                      ? job.projectId === pin.targetId : job.topicId === pin.targetId).length}</span>
                  </Button>
                )
              );
            })}
          </div></div>
        </div>
        <nav id="sidebar-projects" className="project-nav navigation-collapse" data-expanded={projectsExpanded} inert={!projectsExpanded} aria-label="Projects">
          <div>
          {data.projects
            .filter((p) => p.id !== "inbox")
            .map((p) => (
              <Button
                key={p.id}
                data-navigation-id={`projects:${p.id}`}
                draggable
                onDragStart={(event) => navigationDrag(event, "projects", p.id)}
                onKeyDown={async (event) => {
                  if (
                    event.altKey &&
                    ["ArrowUp", "ArrowDown"].includes(event.key)
                  ) {
                    event.preventDefault();
                    showError(
                      await reorderAction({
                        collection: "projects",
                        id: p.id,
                        direction: event.key === "ArrowUp" ? -1 : 1,
                      }),
                    );
                    await refresh();
                  }
                }}
                {...navigationTargetProps("projects", p.id)}
                onDrop={async (event) => {
                  if (await navigationDrop(event, "projects", p.id)) return;
                  const raw = event.dataTransfer.getData(
                    "application/x-image-queue-jobs",
                  );
                  if (!raw) return;
                  event.preventDefault();
                  try {
                    const ids: unknown = JSON.parse(raw);
                    if (
                      !Array.isArray(ids) ||
                      ids.some((id) => typeof id !== "string")
                    )
                      throw new Error("Invalid selection");
                    for (const id of ids)
                      showError(await moveJobAction({ id, projectId: p.id }));
                    setSelectedIds([]);
                    await refresh();
                    setNotice(`Moved ${ids.length} ${ids.length === 1 ? "image" : "images"} to ${p.name}.`);
                  } catch (error) {
                    setNotice((error as Error).message);
                  }
                }}
                variant="ghost"
                className={`nav-item ${project === p.id && !settingsPage && !queuePage ? "selected" : ""}`}
                aria-current={project === p.id && !settingsPage && !queuePage && !topic ? "page" : undefined}
                onClick={() => {
                  navigateProject(p.id);
                  setFilter("all");
                }}
              >
                <Folder size={16} />
                <span className="project-name">{p.name}</span>
                <ChangingLabel value={String(activeJobs.filter(j => j.projectId === p.id).length)} />
              </Button>
            ))}
          </div>
        </nav>
        <Button
          variant="ghost"
          className="nav-item add-project"
          onClick={() => setNewProject(true)}
        >
          <Plus size={16} /> New project
        </Button>
        {project !== "all" && project !== "inbox" && (
          <div className="topic-nav">
            <div className="section-label">
              Topics{" "}
              <Button
                variant="ghost"
                size="icon"
                aria-label="New topic"
                onClick={() => setNewTopic(true)}
              >
                <Plus size={16} />
              </Button>
            </div>
            {data.topics
              ?.filter((t) => t.projectId === project)
              .sort((a, b) => a.order - b.order)
              .map((t) => (
                <Button
                  key={t.id}
                  data-navigation-id={`topics:${t.id}`}
                  draggable
                  onDragStart={(event) => navigationDrag(event, "topics", t.id)}
                  {...navigationTargetProps("topics", t.id)}
                  onDrop={async (event) => {
                    if (await navigationDrop(event, "topics", t.id)) return;
                    const raw = event.dataTransfer.getData(
                      "application/x-image-queue-jobs",
                    );
                    if (!raw) return;
                    event.preventDefault();
                    try {
                      showError(
                        await moveToTopicAction({
                          ids: JSON.parse(raw),
                          topicId: t.id,
                        }),
                      );
                      await refresh();
                    } catch (error) {
                      setNotice((error as Error).message);
                    }
                  }}
                  onKeyDown={async (event) => {
                    if (
                      event.altKey &&
                      ["ArrowUp", "ArrowDown"].includes(event.key)
                    ) {
                      event.preventDefault();
                      showError(
                        await reorderAction({
                          collection: "topics",
                          id: t.id,
                          direction: event.key === "ArrowUp" ? -1 : 1,
                        }),
                      );
                      await refresh();
                    }
                  }}
                  variant="ghost"
                  className={`nav-item ${topic === t.id ? "selected" : ""}`}
                  aria-current={!settingsPage && topic === t.id ? "page" : undefined}
                  onClick={() => setTopic(t.id)}
                >
                  {t.name}
                </Button>
              ))}
            {topic && (
              <div className="field">
                <Label htmlFor="rename-topic">Rename topic</Label>
                <Input
                  id="rename-topic"
                  value={renameTopicName}
                  placeholder={currentTopic?.name}
                  onChange={(event) => setRenameTopicName(event.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!renameTopicName.trim()}
                  onClick={async () => {
                    showError(
                      await renameTopicAction({
                        id: topic,
                        name: renameTopicName,
                      }),
                    );
                    setRenameTopicName("");
                    await refresh();
                  }}
                >
                  Save name
                </Button>
              </div>
            )}
            {topic && (
              <SelectInput
                label="Move topic to project"
                value={project}
                options={data.projects
                  .filter((p) => p.id !== "inbox")
                  .map((p) => ({ value: p.id, label: p.name }))}
                onValueChange={async (projectId) => {
                  showError(await moveTopicAction({ id: topic, projectId }));
                  navigateProject(projectId);
                  await refresh();
                }}
              />
            )}
            {topic && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  showError(await deleteTopicAction({ id: topic }));
                  setTopic("");
                  await refresh();
                }}
              >
                Delete topic
              </Button>
            )}

          </div>
        )}
        {(["archive", "trash"] as const).map(view => <Button key={view} variant="ghost"
          onDragOver={event => {
            if (!event.dataTransfer.types.includes("application/x-image-queue-jobs")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setRetentionDrop(view);
          }}
          onDragLeave={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
              setRetentionDrop(null);
          }}
          onDrop={async event => {
            setRetentionDrop(null);
            const raw = event.dataTransfer.getData("application/x-image-queue-jobs");
            if (!raw) return;
            event.preventDefault();
            try {
              const {result} = await retainCards(JSON.parse(raw), view, stacked, () => setSelectedIds([]));
              showError(result);
              if (result?.data?.undoId) setUndoHistory(history => [...history, result.data!.undoId]);
              showRetentionNotice(`${result?.data?.changed.length ?? 0} moved to ${view}. ${result?.data?.skipped.length ?? 0} skipped.`, Boolean(result?.data?.undoId));
            } catch (error) {
              setNotice((error as Error).message);
            }
          }}
          className={`nav-item ${retentionDrop === view ? "bg-accent ring-1 ring-primary" : ""} ${retentionView === view && !settingsPage ? "selected" : ""}`} aria-current={retentionView === view && !settingsPage ? "page" : undefined} onClick={() => {if(settingsPage){router.push(`/?view=${view}`);return;}window.history.replaceState({}, "", `/?view=${view}`);setQueuePage(false);setRetentionView(view);setProject("all");setTopic("");setFilter("all");setSearch("");setTagFilter("");setSelectedIds([]);}}>{view === "archive" ? <Archive size={17} /> : <Trash size={17} />}<ChangingLabel value={retentionDrop === view ? (view === "archive" ? "Drop to archive" : "Drop to trash") : (view === "archive" ? "Archive" : "Trash")} /><span>{data.jobs.filter(job => view === "trash" ? job.trashedAt : job.archivedAt && !job.trashedAt).length}</span></Button>)}
        <div className="sidebar-bottom">
          <div className="queue-health">
            <div>
              Codex queue
              <span aria-live="polite" aria-atomic="true"><ChangingLabel value={data.cloud ? "Local companion required" : (!data.localRunner && !data.pulses.length && !data.jobs.some(job => job.source === "queue")) ? "Not configured" : health} /></span>
            </div>
          </div>
          <Button
            variant="ghost"
            className={`nav-item ${settingsPage ? "selected" : ""}`}
            aria-current={settingsPage ? "page" : undefined}
            onClick={() => router.push("/settings")}
          >
            <Settings2 size={17} /> Settings
          </Button>
          <div className="sidebar-social-links"><a href={projectLinks.repository} className={buttonVariants({variant:"ghost",className:"nav-item"})} target="_blank" rel="noreferrer"><GithubLogo size={17}/>GitHub<ArrowUpRight className="external-link-corner" size={12} aria-hidden="true"/></a><a href={projectLinks.x} className={buttonVariants({variant:"ghost",className:"nav-item"})} target="_blank" rel="noreferrer"><XLogo size={17}/>Follow<ArrowUpRight className="external-link-corner" size={12} aria-hidden="true"/></a></div>
          <div className="profile">
            <div>
              Personal workspace<span>Made for your next idea</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle color theme"
              onClick={() => {
                setDark(!dark);
                try {
                  window.localStorage.setItem("image-queue-theme", dark ? "light" : "dark");
                } catch {
                  // Keep the current view usable without persistent storage.
                }
              }}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
          </div>
        </div>
      </aside>
      <main ref={workspaceMain}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            void importImages(event.dataTransfer.files);
          }
        }}
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">{readySinceOpening > 0 && `${readySinceOpening} ${readySinceOpening === 1 ? "image is" : "images are"} ready since opening this workspace.`}</div>
        {data.platformSupport?.warning && <p role="status" className="platform-notice">{data.platformSupport.warning}</p>}
        <input
          ref={importInput}
          data-testid="import-file-input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            if (event.target.files) void importImages(event.target.files);
            event.target.value = "";
          }}
        />
        <header className="topbar">
          <div>
            <Folder size={16} />
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong className={retentionView !== "active" ? undefined : "desktop-project-name"}>
              {settingsPage
                ? "Settings"
                : retentionView === "archive"
                  ? "Archive"
                  : retentionView === "trash"
                    ? "Trash"
                    : queuePage
                  ? "Queue"
                  : project === "inbox"
                    ? "Inbox"
                    : (currentTopic?.name ??
                      currentProject?.name ??
                      "All images")}
            </strong>
            {retentionView === "active" && <SelectInput
              className="mobile-project-selector"
              label="Project"
              value={project}
              onValueChange={navigateProject}
              options={[
                { value: "all", label: "All images" },
                ...data.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
            />}
          </div>
          <div className="top-actions">
            <span className="storage-label">
              {data.cloud ? "Cloud workspace" : "Stored on your device"}
            </span>
            <Tooltip label="Like image-queue? Give it a star."><a className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "top-link top-link-github" })} aria-label="image-queue on GitHub" href={projectLinks.repository} target="_blank" rel="noreferrer">
              <GithubLogo size={14} />
            </a></Tooltip>
            <Tooltip label="Let your coding agent request images and use your gallery."><Button
              variant="outline"
              size="sm"
              aria-label="Connect agent"
              onClick={() => router.push("/settings#agent-connection")}
            >
              <Terminal size={14} /> <span>Connect agent</span>
            </Button></Tooltip>
          </div>
        </header>
        {settingsPage ? (
          <section className="settings-page">
            <SettingsNav cloud={data.cloud} localRunner={Boolean(data.localRunner)} />
            <div className="settings-content">
            {notice && <p className="settings-notice" role="status">{notice}</p>}
            <header className="settings-heading">
              <h1>Settings</h1>
              <p>Providers, workers, storage and agent connections for this workspace.</p>
            </header>
            <section id="generation-source" className="settings-card" aria-labelledby="generation-source-title">
              <header className="settings-card-header"><h2 id="generation-source-title">Default generation source</h2><p>Used for new requests in the editor and by agents that do not specify a source. Existing requests keep their source.</p></header>
              <div className="settings-row">
                <div className="settings-row-text">
                  <Label htmlFor="default-generation-source">Source</Label>
                  <span className="settings-row-hint">Changing this setting does not start generation or resume a paused queue.</span>
                </div>
                <div className="settings-row-control">
                  <SelectInput id="default-generation-source" label="Default generation source" className="w-full" disabled={savingSource} value={data.generationSource?.source ?? defaultGenerationSource(data)} onValueChange={value => void changeDefaultSource(value as typeof source)} options={[{ value: "api", label: "OpenAI API · billed to your key" }, { value: "queue", label: "Codex · your ChatGPT plan", disabled: data.cloud }]} />
                </div>
              </div>
            </section>
            <section id="provider-connection" className="settings-card" aria-labelledby="provider-connection-title">
              <header className="settings-card-header">
                <h2 id="provider-connection-title">Providers</h2>
                <p>
                  Keys use the system keychain or a private credential file. All
                  clients share the same connection.
                </p>
              </header>
              <div className="settings-subsection">
                <h3 className="settings-subheading">Connected providers</h3>
                {connectedProviders.length === 0 ? (
                  <p className="settings-empty">No provider connected yet.</p>
                ) : (
                  <ul className="settings-list">
                    {connectedProviders.map((name) => (
                      <ConnectedProviderRow
                        key={name}
                        provider={name}
                        label={providerOptions.find((option) => option.value === name)?.label ?? name}
                        count={data.models.filter((entry) => entry.provider === name).length}
                        revision={keyRevisions[name] ?? 0}
                        onDisconnect={async () => {
                          const result = await disconnectAction({ provider: name });
                          if (result.serverError) setNotice(result.serverError);
                          else await refresh();
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
              <form
                className="settings-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setProviderError("");
                  setProviderSuccess("");
                  setBusy(true);
                  try {
                    const result = await connectAction({ provider, apiKey });
                    showError(result);
                    setKeyRevisions(current => ({ ...current, [provider]: (current[provider] ?? 0) + 1 }));
                    setApiKey("");
                    const discovered = result?.data ?? [];
                    setData(current => ({ ...current, models: [
                      ...current.models.filter(entry => entry.provider !== provider), ...discovered,
                    ] }));
                    setProviderSuccess("Provider connected and image models refreshed");
                    try { await refresh(); } catch {
                      setProviderSuccess("Provider connected. Refresh the page to reload the workspace.");
                    }
                  } catch (e) {
                    setProviderError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="settings-row">
                  <div className="settings-row-text">
                    <Label htmlFor="provider">Provider</Label>
                    <span className="settings-row-hint">Connect a new provider or replace the key of a connected one.</span>
                  </div>
                  <div className="settings-row-control">
                    <SelectInput
                      id="provider"
                      label="Provider"
                      side="bottom"
                      className="w-full"
                      value={provider}
                      onValueChange={(value) => {
                        setProvider(value as typeof provider);
                        setProviderError("");
                      }}
                      options={providerOptions}
                    />
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <Label htmlFor="api-key">API key</Label>
                    <span className="settings-row-hint">Connecting loads the provider’s image models.</span>
                  </div>
                  <div className="settings-row-control">
                    <Input
                      id="api-key"
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setProviderError("");
                      }}
                      aria-invalid={providerError ? true : undefined}
                      aria-describedby={providerError ? "api-key-error" : undefined}
                      placeholder="Paste your provider API key"
                      required
                    />
                    {providerError && <p id="api-key-error" role="alert" className="field-error break-words">{providerError}</p>}
                  </div>
                </div>
                <div className="settings-card-footer">
                  <div className="settings-footer-status">
                    <p className="provider-connection-status" role="status">{connectedProviders.includes(provider) ? "Connected" : "Not connected"}</p>
                    {providerSuccess && <p className="provider-success" role="status">{providerSuccess}</p>}
                  </div>
                  <Button type="submit" disabled={busy}>
                    {busy && <LoaderCircle className="spin" aria-hidden="true" size={16} />}
                    {busy ? "Connecting…" : connectedProviders.includes(provider) ? "Update key & refresh models" : "Connect & load models"}
                  </Button>
                </div>
              </form>
            </section>
            <section id="worker-pool" className="settings-card" aria-labelledby="worker-pool-title">
              <header className="settings-card-header">
                <h2 id="worker-pool-title">{data.localRunner ? "Codex queue" : "Worker pool"}</h2>
                <p>
                  {data.localRunner
                    ? "Generate through your local Codex installation. Pausing lets running images finish. Keep image-queue running."
                    : "Five fixed Codex slots. Disabled slots finish their current image before stopping. Codex must be running."}
                </p>
              </header>
              {!data.localRunner && workerSetupLink(data.mcpLaunch, data.pool, dashboardOrigin) && <div className="settings-row worker-setup-row">
                <div className="settings-row-text">
                  <span className="settings-row-label">Set up workers in Codex</span>
                  <span className="settings-row-hint">Open a prepared chat, then press Send. Codex will configure this queue and check existing workers to avoid duplicates. Keep Codex running for scheduled work.</span>
                </div>
                <a className={buttonVariants({ variant: "default" })} href={workerSetupLink(data.mcpLaunch, data.pool, dashboardOrigin)}>Set up in Codex</a>
              </div>}
              {data.localRunner ? <div className="settings-subsection"><div className="runner-state-row"><h3 className="settings-subheading">{data.localRunner.blockedReason ? "Queue stopped — action needed" : data.localRunner.paused ? "Paused" : data.localRunner.running ? "Generating" : "Ready"}</h3><Button variant="secondary" disabled={poolSaving} onClick={async()=>{setPoolSaving(true);try{showError(await pauseLocalRunnerAction({paused:!(data.localRunner?.paused || data.localRunner?.blockedReason)}));await refresh();}finally{setPoolSaving(false);}}}>{data.localRunner.paused || data.localRunner.blockedReason ? "Resume queue" : "Pause"}</Button></div><p className="settings-row-hint">{data.localRunner.running} generating · {data.localRunner.desiredWorkers ?? data.localRunner.enabled} {(data.localRunner.desiredWorkers ?? data.localRunner.enabled) === 1 ? "parallel request" : "parallel requests"}.{data.pulses.length > 0 && " Scheduled chats take no new requests."}</p>{data.localRunner.blockedReason && <div className="detail-notice runner-attention" role="status"><p>{workerStatusMessage(data.localRunner.blockedReason)}{data.localRunner.resumeAt && " Pending requests will resume automatically after the limit resets."}</p><p>{data.localRunner.resumeAt ? "The remaining queue will resume after the verified quota reset." : "The remaining queue is stopped. Review the affected image below, then choose Resume queue to continue other requests. The interrupted image will not be retried automatically."}</p><div className="runner-attention-actions">{stoppedJob && <Button variant="outline" onClick={() => setSelected(stoppedJob)}>Inspect stopped image</Button>}{/CLI (is unavailable|could not be located)/.test(data.localRunner.blockedReason) && <CopyButton variant="outline" size="default" value="npm install -g @openai/codex" label="Copy install command" onSuccess={() => setNotice("Install command copied")} onError={() => setNotice("Could not copy the install command")}>Copy install command</CopyButton>}{/Sign in|API key/.test(data.localRunner.blockedReason) && <CopyButton variant="outline" size="default" value="codex login" label="Copy sign-in command" onSuccess={() => setNotice("Sign-in command copied")} onError={() => setNotice("Could not copy the sign-in command")}>Copy sign-in command</CopyButton>}<Button variant="secondary" disabled={poolSaving} onClick={async () => {setPoolSaving(true);try{showError(await recheckLocalRunnerAction({}));await refresh();}finally{setPoolSaving(false);}}}>Check again</Button></div></div>}</div> : <div className="settings-subsection">
                <h3 className="settings-subheading">Workers</h3>
                {data.pool.workers === 0 && !data.pulses.some(pulse => pulse.draining) && <p className="settings-empty">Workers are turned off.</p>}
                {slotsWithoutHeartbeat > 0 && (
                  <p className="settings-empty">{slotsWithoutHeartbeat === data.pool.workers
                    ? "No active worker has reported a heartbeat yet."
                    : `${slotsWithoutHeartbeat} active ${slotsWithoutHeartbeat === 1 ? "worker is" : "workers are"} awaiting a first heartbeat.`}</p>
                )}
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th scope="col">Worker</th>
                      <th scope="col">State</th>
                      <th scope="col">Last heartbeat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].filter(slot => slot <= data.pool.workers || data.pulses.some(pulse => pulse.slot === slot && pulse.draining)).map((slot) => {
                      const pulse = data.pulses.find((p) => p.slot === slot);
                      const overdue = pulse && !pulseIsFresh(pulse, healthNow);
                      return (
                        <tr key={slot}>
                          <th scope="row">Worker {slot}</th>
                          <td>
                            {pulse?.draining
                              ? overdue ? "Heartbeat overdue" : "Finishing current image"
                              : slot > data.pool.workers || pulse?.mode === "disabled"
                                ? "Standby"
                                : pulse
                                  ? overdue ? "Heartbeat overdue" : pulse.mode
                                  : "—"}
                          </td>
                          <td>
                            {pulse
                              ? <time dateTime={pulse.lastWake}>{`${Math.max(0, Math.floor((healthNow - Date.parse(pulse.lastWake)) / 60000))} min ago`}</time>
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>}
              <form
                className="settings-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (poolSaving) return;
                  setPoolSaving(true);
                  try {
                    const result = await poolConfigAction(poolDraft);
                    showError(result);
                    await refresh();
                    setPoolSaveRevision(value => value + 1);
                  } catch (error) {
                    setNotice((error as Error).message);
                  } finally {
                    setPoolSaving(false);
                  }
                }}
              >
                <details className="runner-advanced" open={data.localRunner ? undefined : true}>
                  <summary>Advanced options</summary>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <Label htmlFor="pool-worker-model">{data.localRunner ? "Worker model" : "Worker chat model"}</Label>
                    <span id="pool-worker-model-hint" className="settings-row-hint">{data.localRunner ? "The local Codex model that submits each image request; the image generator is separate." : "The Codex chat that processes requests; the image generator is separate."}</span>
                  </div>
                  <div className="settings-row-control">
                    <SelectInput id="pool-worker-model" label={data.localRunner ? "Worker model" : "Worker chat model"} side="bottom" className="w-full"
                      value={poolDraft.workerModel ?? "gpt-6.1-sol"}
                      options={workerModels.map(model => ({ ...model }))}
                      onValueChange={value => setPoolDraft(current => ({ ...current, workerModel: value as PoolConfig["workerModel"] }))} />
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <Label htmlFor="pool-worker-effort">Reasoning effort</Label>
                  </div>
                  <div className="settings-row-control">
                    <SelectInput id="pool-worker-effort" label="Reasoning effort" side="bottom" className="w-full"
                      value={poolDraft.workerEffort ?? "low"}
                      options={workerEfforts.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
                      onValueChange={value => setPoolDraft(current => ({ ...current, workerEffort: value as PoolConfig["workerEffort"] }))} />
                  </div>
                </div>
                </details>
                {(
                  [
                    {
                      key: "workers",
                      label: data.localRunner ? "Parallel requests" : "Active workers",
                      hint: data.localRunner ? "Maximum images generated at once. Pause keeps this setting." : "Number of slots allowed to take new requests.",
                      max: 5,
                      min: data.localRunner ? 1 : 0,
                    },
                    {
                      key: "idleMinutes",
                      label: "Idle interval (minutes)",
                      hint: "Time between queue checks when the queue is idle.",
                      max: 60,
                      min: 1,
                    },
                    {
                      key: "activeMinutes",
                      label: "Active interval (minutes)",
                      hint: "Time between queue checks after recent activity.",
                      max: 60,
                      min: 1,
                    },
                    {
                      key: "activityWindowMinutes",
                      label: "Activity window (minutes)",
                      hint: "How long after the last reservation workers use the active interval.",
                      max: 120,
                      min: 1,
                    },
                  ] as const
                ).filter(field => !data.localRunner || field.key === "workers").map((field) => (
                  <div className="settings-row" key={field.key}>
                    <div className="settings-row-text">
                      <Label htmlFor={`pool-${field.key}`}>{field.label}</Label>
                      <span id={`pool-${field.key}-hint`} className="settings-row-hint">{field.hint}</span>
                    </div>
                    <div className="settings-row-control settings-row-control-narrow">
                      <Input
                        id={`pool-${field.key}`}
                        aria-describedby={`pool-${field.key}-hint`}
                        type="number"
                        min={field.min}
                        max={field.max}
                        value={poolDraft[field.key]}
                        onChange={(event) =>
                          setPoolDraft({
                            ...poolDraft,
                            [field.key]: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
                <div className="settings-card-footer">
                  <SavedStatus revision={poolSaveRevision} />
                  <Button type="submit" variant="outline" disabled={poolSaving}>
                    {poolSaving ? "Saving…" : "Save worker settings"}
                  </Button>
                </div>
              </form>
              {!data.localRunner && <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-hint">Model and reasoning are saved preferences. To apply them to existing worker chats, copy the saved configuration below and paste it into Codex. Saving here does not change a chat's model.</span>
                </div>
                <CopyButton variant="outline" size="default" label="Copy saved worker configuration" disabled={poolSaving}
                  value={workerConfigurationPrompt(data.pool)}
                  onSuccess={() => setNotice("Worker configuration copied. Paste it into Codex to apply.")}
                  onError={() => setNotice("Could not copy worker configuration.")}>
                  Copy saved worker configuration
                </CopyButton>
              </div>}
            </section>
            {!data.cloud && <ProjectFolderSettings projects={data.projects} homeDirectory={settingsHomeDirectory} onSaved={refresh} />}
            {!data.cloud && (
              <section id="local-directories" className="settings-card" aria-labelledby="local-directories-title">
                <header className="settings-card-header">
                  <h2 id="local-directories-title">Local directories</h2>
                  <p>Where queue requests are written and which folders references may come from.</p>
                </header>
                <form
                  className="settings-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      showError(
                        await pathSettingsAction({
                          queueDirectory,
                          referenceDirectories: referenceDirectories
                            .split("\n")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        }),
                      );
                      await refresh();
                      setDirectorySaveRevision(value => value + 1);
                    } catch (error) {
                      setNotice((error as Error).message);
                    }
                  }}
                >
                  <div className="settings-row settings-row-stacked">
                    <div className="settings-row-text">
                      <Label htmlFor="queue-directory">Queue directory</Label>
                      <span className="settings-row-hint">Existing queue jobs remain linked to their original queue.</span>
                    </div>
                    <div className="settings-path-control">
                      <Input
                        id="queue-directory"
                        value={queueDirectory}
                        onChange={(event) => setQueueDirectory(event.target.value)}
                        required
                      />
                      <Button type="button" variant="outline" disabled={pickingDirectory !== null} onClick={() => void chooseDirectory("queue")}>{pickingDirectory === "queue" ? "Choosing folder…" : "Choose folder…"}</Button>
                    </div>
                  </div>
                  <div className="settings-row settings-row-stacked">
                    <div className="settings-row-text">
                      <Label htmlFor="reference-directories">
                        Allowed reference directories
                      </Label>
                      <span className="settings-row-hint">One reference directory per line.</span>
                    </div>
                    <div className="settings-path-control">
                      <Textarea
                        id="reference-directories"
                        value={referenceDirectories}
                        onChange={(event) =>
                          setReferenceDirectories(event.target.value)
                        }
                        required
                      />
                      <Button type="button" variant="outline" disabled={pickingDirectory !== null} onClick={() => void chooseDirectory("reference")}>{pickingDirectory === "reference" ? "Choosing folder…" : "Add folder…"}</Button>
                    </div>
                  </div>
                  <div className="settings-card-footer">
                    <SavedStatus revision={directorySaveRevision} />
                    <Button type="submit" variant="outline">
                      Save directories
                    </Button>
                  </div>
                </form>
              </section>
            )}
            <section id="tag-settings" className="settings-card" aria-labelledby="tag-settings-title">
              <header className="settings-card-header">
                <h2 id="tag-settings-title">Tags and search</h2>
                <p>Rename, merge or remove a tag across the whole library.</p>
              </header>
              <div className="settings-row">
                <div className="settings-row-text">
                  <Label htmlFor="library-tag">Existing tag</Label>
                  <span className="settings-row-hint">Counts show how many images carry the tag.</span>
                </div>
                <div className="settings-row-control">
                  <SelectInput id="library-tag" label="Existing tag" className="w-full" disabled={savingLibraryTag} value={tagFrom} onValueChange={setTagFrom}
                    placeholder="Choose a tag"
                    options={tagCounts(data.jobs).map(({tag, count}) => ({value:tag, label:`${tag} (${count})`}))} />
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <Label htmlFor="tag-to">Rename or merge into</Label>
                  <span className="settings-row-hint">An existing tag name merges both tags.</span>
                </div>
                <div className="settings-row-control">
                  <Input
                    id="tag-to"
                    maxLength={MAX_TAG_LENGTH}
                    disabled={savingLibraryTag}
                    value={tagTo}
                    onChange={(event) => setTagTo(event.target.value)}
                  />
                </div>
              </div>
              <div className="settings-row settings-row-actions">
                <Button
                  variant="outline"
                  disabled={savingLibraryTag || !tagFrom.trim()}
                  onClick={() => void updateLibraryTag()}
                >
                  Remove tag
                </Button>
                <Button
                  variant="outline"
                  disabled={savingLibraryTag || !tagFrom.trim() || !tagTo.trim() || tagTo.length > MAX_TAG_LENGTH}
                  onClick={() => void updateLibraryTag(tagTo)}
                >
                  Rename or merge
                </Button>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-label">Search index</span>
                  <span className="settings-row-hint">Rebuild when search misses images you know are there.</span>
                </div>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      showError(await rebuildIndexAction({}));
                      setNotice("Search index rebuilt");
                    } catch (error) {
                      setNotice((error as Error).message);
                    }
                  }}
                >
                  Rebuild search index
                </Button>
              </div>
            </section>
            <AgentConnection platform={data.cloud ? undefined : data.platformSupport?.platform} launch={data.mcpLaunch} dashboardOrigin={dashboardOrigin} onNotice={setNotice} />
            </div>
          </section>
        ) : (
          <>
            <section className="content">
              <div className="page-heading">
                <div>
                  <h1 ref={galleryHeading} tabIndex={-1}>
                    {retentionView !== "active" ? (retentionView === "archive" ? "Archive" : "Trash") : queuePage
                      ? "Your queue"
                      : project === "inbox"
                        ? "Inbox"
                        : (currentTopic?.name ??
                          currentProject?.name ??
                          "All images")}
                    <span>{jobs.length}</span>
                  </h1>
                  <p>
                    {retentionView === "trash"
                      ? "Images stay in Trash for 30 days."
                      : retentionView === "archive"
                        ? "Archived images can be restored to your gallery."
                        : queuePage
                      ? health
                      : `${counts.done} ready · ${counts.active} in progress · ${counts.attention} need attention`}
                  </p>
                </div>
                <div className="page-heading-actions">
                {currentProject && retentionView === "active" && (            <Button
              variant="outline"
              onClick={async () => {
                showError(
                  await pinAction({
                    targetType: topic ? "topic" : "project",
                    targetId: topic || project,
                    pinned: !(data.pins ?? []).some(
                      (pin) => pin.targetId === (topic || project),
                    ),
                  }),
                );
                await refresh();
              }}
            >
              {(data.pins ?? []).some(
                (pin) => pin.targetId === (topic || project),
              )
                ? "Unpin"
                : "Pin"}{" "}
              {topic ? "topic" : "project"}
            </Button>)}
                {!queuePage && retentionView === "active" && <Tooltip label="Add existing images to your gallery."><Button
                  variant="outline"
                  onClick={() => importInput.current?.click()}
                >
                  Import images
                </Button></Tooltip>}
                {retentionView === "trash" && viewJobs.length > 0 && (
                  <Button variant="outline" onClick={() => {
                    setNotice("");
                    setPurgeError("");
                    setRemoveExternal(false);
                    setPurgeProgress({ processed: 0, deleted: 0 });
                    setPurgeIds(viewJobs.map(job => job.id));
                  }}>Empty trash</Button>
                )}
                {retentionView === "active" && <Button onClick={() => { setComposerCollapsed(false); requestAnimationFrame(() => promptInput.current?.focus()); }}>
                  <Plus size={16} /> New image
                </Button>}
                </div>
              </div>
              {retentionView === "active" && data.localRunner && (data.localRunner.paused || data.localRunner.blockedReason) && data.jobs.some(job => job.source === "queue" && (job.status === "queued" || (job.status === "running" && Boolean(data.localRunner?.blockedReason))) && !job.trashedAt && !job.archivedAt) && (
                data.localRunner.blockedReason ? (
                <div className="queue-paused-notice" role="status">
                  <Clock3 size={20} aria-hidden="true" />
                  <div><strong>{isSizeMismatchError(data.localRunner.blockedReason) ? "Codex queue stopped — image size mismatch" : "Queue stopped — action needed"}</strong><p>{isSizeMismatchError(data.localRunner.blockedReason) ? `The image was generated${stoppedJob?.providerResultSize ? ` at ${stoppedJob.providerResultSize.width}×${stoppedJob.providerResultSize.height}` : ""}, but does not match the requested size. Inspect the original before retrying. API requests can still run.` : <>{workerStatusMessage(data.localRunner.blockedReason)} {data.localRunner.resumeAt ? "Queued images will resume automatically after the limit resets." : data.localRunner.running > 0 ? `${data.localRunner.running} images are still finishing. New Codex requests wait until you resume.` : "Nothing is generating. Waiting images stay in the queue until you resume it."}</>}</p></div>
                  {stoppedJob && <Button variant="outline" onClick={() => setSelected(stoppedJob)}>Inspect stopped image</Button>}
                  <Link className={buttonVariants({ variant: "secondary" })} href="/settings#worker-pool" prefetch>Manage workers</Link>
                </div>
                ) : (
                <div className="queue-paused-notice" role="status">
                  <Clock3 size={20} aria-hidden="true" />
                  <div><strong>Generation paused</strong><p>Queued images are waiting. Resume to start generating on this machine.</p></div>
                  <Button variant="secondary" disabled={poolSaving} onClick={async () => {
                    setPoolSaving(true);
                    try { showError(await pauseLocalRunnerAction({ paused: false })); await refresh(); }
                    catch (error) { setNotice((error as Error).message); }
                    finally { setPoolSaving(false); }
                  }}>Resume</Button>
                </div>
                )
              )}
              {(selectedIds.length > 0 || (retentionView === "active" && (queuePage ? active : galleryScope.length > 0))) && <SelectionToolbar selected={selectedIds.length > 0}>
                {showFilterRow && (
                <div ref={filterRow} onScroll={measureFilters} className={`filters ${filterEdges.left ? "fade-left" : ""} ${filterEdges.right ? "fade-right" : ""}`}>
                  {(queuePage ? [
                    ["all", "All requests"], ["queued", "Waiting"], ["reserved", "Reserved"], ["running", "Generating"],
                  ] : [
                    ["all", "Everything"],
                    ["done", "Ready"],
                    ["active", "In progress"],
                    ["blocked", "Blocked"],
                  ]).map(([value, text]) => (
                    <Button
                      key={value}
                      size="sm"
                      variant="ghost"
                      className={filter === value ? "active-filter" : ""}
                      aria-pressed={filter === value}

                      onClick={() => setFilter(value)}
                    >
                      {text}{" "}
                      {queuePage
                        ? queueCounts[value as keyof typeof queueCounts]
                        : value === "all"
                        ? counts.total
                        : value === "done"
                          ? counts.done
                          : value === "active"
                            ? counts.active
                            : counts.blocked}
                    </Button>
                  ))}
                </div>
                )}
                <div className="gallery-tools">
                  {selectedIds.length > 0 && (
                    <>
                      {retentionView === "active" && selectedIds.some(id =>
                        jobs.some(job => job.id === id && job.source === "queue" && job.status === "blocked"),
                      ) && <Button disabled={busy} onClick={async () => {
                        setBusy(true);
                        const ids = new Set(selectedIds);
                        const eligible = jobs.filter(job => ids.has(job.id) && job.source === "queue" && job.status === "blocked");
                        const queued = new Set<string>();
                        const errors: string[] = [];
                        try {
                          for (let index = 0; index < eligible.length; index += 1000) {
                            const result = await retryBlockedQueueAction({ ids: eligible.slice(index, index + 1000).map(job => job.id) });
                            showError(result);
                            if (!result?.data) throw new Error("Retry returned no result");
                            result.data.queued.forEach(id => queued.add(id));
                            result.data.failures.forEach(failure => errors.push(failure.message));
                          }
                        } catch (error) {
                          errors.push((error as Error).message);
                        } finally {
                          setSelectedIds(current => current.filter(id => !queued.has(id)));
                          setBusy(false);
                        }
                        setNotice(errors.length
                          ? `${queued.size} queued for retry. ${eligible.length - queued.size} could not be queued. ${errors[0]}`
                          : `${queued.size} queued for retry`);
                        await refresh();
                      }}>Retry</Button>}
                      {([...(retentionView === "active" ? ["archive"] : ["restore"]), ...(retentionView !== "trash" ? ["trash"] : [])] as ("archive"|"trash"|"restore")[]).map(operation => <Button key={operation} variant={retentionView === "trash" && operation === "restore" ? "default" : "outline"} onClick={async () => {
                        try {
                          const {result} = await retainCards(selectedIds, operation, stacked, () => setSelectedIds([]));
                          showError(result);
                          if (result?.data?.undoId) setUndoHistory(history => [...history, result.data!.undoId]);
                          showRetentionNotice(`${result?.data?.changed.length ?? 0} items updated; ${result?.data?.skipped.length ?? 0} active requests skipped`, Boolean(result?.data?.undoId));
                        } catch(error) {setNotice((error as Error).message);}
                      }}>{operation === "archive" ? "Archive" : operation === "trash" ? "Move to trash" : "Restore"}</Button>)}
                      {retentionView === "trash" && <Button variant="destructive" onClick={() => {setNotice("");setPurgeError("");setRemoveExternal(false);setPurgeProgress({ processed: 0, deleted: 0 });setPurgeIds([...selectedIds]);}}>Delete permanently</Button>}
                      <span className="selected-count">
                        <ChangingLabel value={`${selectedIds.length} selected`} />
                      </span>
                      <SelectInput
                        className={retentionView === "active" && filter !== "blocked" ? "compact-select selection-move-primary" : "compact-select"}
                        label="Move selected images"
                        side="bottom"
                        value=""
                        placeholder="Move to…"
                        onValueChange={async (projectId) => {
                          if (!projectId || selectedIds.every(id => data.jobs.find(job => job.id === id)?.projectId === projectId)) return;
                          try {
                            for (const id of selectedIds)
                              showError(await moveJobAction({ id, projectId }));
                            setSelectedIds([]);
                            await refresh();
                            const destination = data.projects.find((item) => item.id === projectId);
                            setNotice(`Moved ${selectedIds.length} ${selectedIds.length === 1 ? "image" : "images"}${destination ? ` to ${destination.name}` : ""}.`);
                          } catch (error) {
                            setNotice((error as Error).message);
                          }
                        }}
                        options={data.projects.map((project) => ({
                          value: project.id,
                          label: project.name,
                          disabled: selectedIds.every(id => data.jobs.find(job => job.id === id)?.projectId === project.id),
                        }))}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Clear selection"
                        onClick={() => setSelectedIds([])}
                      >
                        <X size={14} />
                      </Button>
                    </>
                  )}

                  {selectedIds.length === 0 && <>
                  {availableTags.length > 0 && <SelectInput
                    label="Filter by tag"
                    value={tagFilter}
                    onValueChange={setTagFilter}
                    options={[{value: "", label: "All tags"}, ...availableTags.map(({tag, count}) => ({value: tag, label: `${tag} (${count})`}))]}
                  />}
                  <Button className="search-toggle" variant="outline" size="icon" aria-label="Toggle image search" aria-expanded={searchExpanded} onClick={() => {setSearchExpanded(value => !value); requestAnimationFrame(() => gallerySearchInput.current?.focus());}}><Search size={18} /></Button>
                  <div className={`search ${searchExpanded ? "search-expanded" : ""}`}>
                    <Search size={15} />
                    <Input
                      ref={gallerySearchInput}
                      aria-label="Search images"
                      placeholder="Search images…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {!queuePage && <>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-pressed={stacked}
                    className={stacked ? "bg-muted" : undefined}
                    onClick={() => setStacked((value) => !value)}
                  >
                    {stacked ? "Stacked" : "All versions"}
                  </Button>
                  <ToggleGroup
                    className="view-switch"
                    value={[view]}
                    onValueChange={(values) => {
                      if (values[0]) setView(values[0] as LayoutMode);
                    }}
                  >
                    <Tooltip label="Justified rows"><Toggle value="justified" aria-label="Justified rows">
                      <Rows size={17} />
                    </Toggle></Tooltip>
                    <Tooltip label="Masonry layout"><Toggle value="masonry" aria-label="Masonry layout">
                      <Columns size={17} />
                    </Toggle></Tooltip>
                    <Tooltip label="Equal grid"><Toggle value="grid" aria-label="Equal grid">
                      <GridFour size={17} />
                    </Toggle></Tooltip>
                  </ToggleGroup>
                  </>}
                  </>}
                </div>
              </SelectionToolbar>}
              <GalleryContent empty={loaded && jobs.length === 0}>
              {!loaded ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" />
                  <h2>Opening your workspace</h2>
                </div>
              ) : jobs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <ImageIcon size={32} />
                  </div>
                  <h2>
                    {search
                      ? (queuePage ? "No matching requests" : "No matching images")
                      : retentionView !== "active"
                        ? (retentionView === "trash" ? "Trash is empty" : "Archive is empty")
                        : queuePage
                        ? (filter === "running" ? "No images are generating" : filter === "queued" ? "No requests are waiting" : filter === "reserved" ? "No requests are reserved" : "The queue is empty")
                      : filter === "active"
                        ? "No images in progress"
                        : filter === "blocked"
                          ? "No blocked images"
                          : filter === "done" ? "No finished images yet" : "Your next idea starts here"}
                  </h2>
                  <p>
                    {search
                      ? <>No matches for <span className="break-all">“{search}”</span>.</>
                      : retentionView === "active" && !queuePage && filter === "active"
                        ? `Waiting, reserved, and generating requests will appear here. ${health}.`
                      : retentionView === "active" && !queuePage && filter === "blocked"
                        ? "Requests that need your attention before they can continue will appear here."
                      : retentionView === "active" && !queuePage && filter === "done"
                        ? counts.active > 0
                          ? `${counts.active} ${counts.active === 1 ? "request is" : "requests are"} waiting, reserved, or generating.`
                          : "Finished images will appear here."
                      : retentionView === "trash" ? "Images you move to Trash will appear here." : retentionView === "archive" ? "Images you archive will appear here." : queuePage ? "Requests appear here while they wait, are reserved by a worker, or are generating." : project === "inbox" ? "Drop images here or use Import images to add files." : "Describe an image below, add a reference, and make it yours."}
                  </p>
                  {!search && retentionView === "active" && !queuePage && filter === "done" && counts.active > 0 && (
                    <Button className="mt-3" variant="outline" onClick={() => setFilter("active")}>Show in progress</Button>
                  )}
                  {search && (
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      <Button variant="outline" onClick={() => {
                        setSearch("");
                        gallerySearchInput.current?.focus();
                      }}>Clear search</Button>
                      {!queuePage && retentionView === "active" && project !== "all" && (
                        <Button variant="outline" onClick={() => {
                          setFilter("all");
                          navigateProject("all");
                        }}>Search all projects</Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <Gallery
                  jobs={stacked ? stackedImages(jobs) : jobs}
                  stackCounts={stacked ? viewJobs.reduce<Record<string, number>>((counts, job) => {
                    if (job.stackId) counts[job.stackId] = (counts[job.stackId] ?? 0) + 1;
                    return counts;
                  }, {}) : {}}
                  mode={view}
                  restoreMotionRevision={restoreMotionRevision}
                  insertionMotionRevision={insertionMotionRevision}
                  removalMotionRevision={removalMotionRevision}
                  showArchiveBadge={retentionView !== "archive"}
                  onOpen={setSelected}
                  selectedIds={selectedIds}
                  onSelection={setSelectedIds}
                />
              )}
              </GalleryContent>
            </section>
            {retentionView === "active" && composerCollapsed && <Button className="composer-restore" {...referenceDropHandlers} onClick={() => {setComposerCollapsed(false); requestAnimationFrame(() => promptInput.current?.focus());}}><Plus size={16} /> New image</Button>}
            {retentionView === "active" && !composerCollapsed && selectedIds.length > 0 && (
              <Button className="composer-restore" variant="outline" {...referenceDropHandlers} onClick={() => {
                setSelectedIds([]);
                requestAnimationFrame(() => promptInput.current?.focus());
              }}><Plus size={16} /> New image</Button>
            )}
            <div ref={composerWrap} className="composer-wrap" hidden={composerCollapsed || retentionView !== "active" || selectedIds.length > 0}>
              <form ref={composerSurface} className="composer" {...referenceDropHandlers} onSubmit={form.handleSubmit(submit)}>
              <Button type="button" variant="ghost" size="icon" className="composer-collapse" aria-label="Minimize prompt editor" onClick={() => setComposerCollapsed(true)}><Minimize2 size={16} /></Button>

                <ReferenceStrip ids={selectedRefs.map(reference => reference.id)}>
                    {selectedRefs.map((ref) => (
                      <div key={ref.id} data-reference-id={ref.id}>
                        <img
                          src={`/api/asset?key=${encodeURIComponent(ref.blobKey)}`}
                          alt={ref.name}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          aria-label={`Remove ${ref.name}`}
                          onClick={(event) => {
                            const tile = event.currentTarget.parentElement;
                            const neighbor = tile?.nextElementSibling ?? tile?.previousElementSibling;
                            const focusTarget = neighbor?.querySelector("button") ?? promptInput.current;
                            focusTarget?.focus();
                            setRefs(previous => previous.filter(id => id !== ref.id));
                          }}
                        >
                          <X size={11} />
                        </Button>
                      </div>
                    ))}
                </ReferenceStrip>
                <Textarea
                  {...form.register("prompt")}
                  ref={(element) => {
                    form.register("prompt").ref(element);
                    promptInput.current = element;
                  }}
                  aria-label="Image prompt"
                  placeholder="Describe the image you have in mind…"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (!requestInFlight.current) form.handleSubmit(submit)();
                    }
                  }}
                />
                {form.formState.errors.prompt && (
                  <p className="field-error">
                    {form.formState.errors.prompt.message}
                  </p>
                )}
                <Button
                  type="button"
                  className="mobile-options-toggle"
                  variant="ghost"
                  onClick={() => setComposerExpanded((value) => !value)}
                >
                  {composerExpanded ? "Hide options" : "Image options"}
                </Button>
                <WorkerAlert enabled={source === "queue" && loaded} unavailable={workersUnavailable}
                  instantHeight={priorComposerSource.current !== source}
                  message={queueRequestsNotice ?? ""}
                  manageHref="/settings#worker-pool" />
                <div className="composer-footer">
                  <div className="composer-options">
                    <input
                      ref={fileInput}
                      data-testid="reference-file-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          receiveReferences([], [file]).catch((e) => setNotice(e.message));
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Attach image reference"
                      onClick={() => setLibrary(true)}
                    >
                      <Paperclip size={18} />
                    </Button>
                    {data.projects.length === 0 && loaded ? (
                      <Button type="button" variant="outline" className="compact-select" onClick={() => setNewProject(true)}><Plus size={14} /> Create project</Button>
                    ) : (
                    <SelectInput
                      label="Destination project"
                      side="bottom"
                      contentClassName="max-h-[min(var(--available-height),5rem)]"
                      className="compact-select destination-project-select"
                      value={projectId ?? ""}
                      onValueChange={(value) => {
                        setDestination(value);
                        setDestinationTopic("");
                      }}
                      placeholder="Choose project"
                      options={data.projects.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                    />
                    )}
                    {(data.topics ?? []).some(
                      (item) => item.projectId === projectId && !item.deleted,
                    ) && (
                      <SelectInput
                        label="Destination topic"
                        value={destinationTopic}
                        placeholder="Project only"
                        options={[
                          { value: "", label: "Project only" },
                          ...(data.topics ?? [])
                            .filter((item) => item.projectId === projectId && !item.deleted)
                            .map((item) => ({
                              value: item.id,
                              label: item.name,
                            })),
                        ]}
                        onValueChange={setDestinationTopic}
                      />
                    )}
                    <SelectInput
                      label="Image variants"
                      className="compact-select"
                      value={variants}
                      onValueChange={setVariants}
                      options={[1, 2, 3, 4].map((count) => ({
                        value: String(count),
                        label: `${count} ${count === 1 ? "image" : "images"}`,
                      }))}
                    />
                    <div>
                      <SelectInput
                        label="Generation source"
                        disabled={savingSource}
                        value={source}
                        onValueChange={(value) => void changeDefaultSource(value as typeof source)}
                        options={[
                          {
                            value: "queue",
                            label: "Codex queue",
                            disabled: data.cloud,
                          },
                          { value: "api", label: "Your API key" },
                        ]}
                      />
                    </div>
                    {source === "api" && models.length === 0 && connectedProviders.length === 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="provider-connect-button"
                        onClick={() => router.push(`/settings?provider=${provider}`)}
                      >
                        Connect {providerLabels[provider]} to choose a model
                      </Button>
                    )}
                    {source === "api" && connectedProviders.length > 0 && (
                      <>
                        <SelectInput
                          label="Provider"
                          className="compact-select"
                          value={provider}
                          onValueChange={(value) => {
                            setProvider(value as typeof provider);
                            setModel("");
                            setResolution("");
                          }}
                          options={providerOptions.filter((entry) =>
                            connectedProviders.includes(
                              entry.value as typeof provider,
                            ),
                          )}
                        />
                        <SelectInput
                          label="Image model"
                          disabled={savingSource}
                          className="compact-select model-select"
                          value={model}
                          onValueChange={value => { setResolution(""); void changeDefaultSource("api", value); }}
                          placeholder={models.length ? "Select model" : "No models available"}
                          options={models.map((model) => ({
                            value: model.id,
                            label: model.name,
                            disabled: !model.sizeProfile || (refs.length > 0 && !model.references),
                          }))}
                        />
                      </>
                    )}
                    {resolutionLevels.length > 0 && (
                      <SelectInput
                        label="Resolution"
                        className="compact-select"
                        value={selectedResolution ?? ""}
                        onValueChange={setResolution}
                        options={[
                          { value: "", label: "Default resolution" },
                          ...resolutionLevels.map(level => ({ value: level, label: level })),
                        ]}
                      />
                    )}
                    <SelectInput
                      id="composer-image-size"
                      contentClassName="image-size-menu"
                      label="Image size"
                      className="compact-select"
                      value={size}
                      deferValue="custom"
                      onValueChange={value => value === "custom" ? (setCustomSizeError(""), setCustomSize(true)) : (setSize(value), setCustomDimensionsSelected(savedCustomSizes.includes(value)), setSizeFallback(null))}
                      options={[...sizes.map((value) => ({
                        value,
                        label: ratioFirstLabel(value),
                      })), ...(supportsCustomSize ? [{value:"custom",label:"Custom size…"}] : [])]}
                    />
                    <div className="alpha-option">
                      <Checkbox
                        id="transparent-background"
                        aria-label="Transparent"
                        checked={transparent}
                        disabled={!transparencyAllowed}
                        onCheckedChange={setTransparent}
                      />
                      <Label htmlFor="transparent-background">
                        Transparent
                      </Label>
                    </div>
                  </div>
                  {(busy || promptEmpty || (source === "api" && (!model || !sizes.length))) && (
                    <span id="generate-disabled-reason" className="sr-only">
                      {busy ? "An image request is being submitted." : promptEmpty ? "Describe the image first." : "Choose a connected model with a supported image size."}
                    </span>
                  )}
                  <Button
                    type="submit"
                    className="generate-button"
                    disabled={busy || promptEmpty || (source === "api" && (!model || !sizes.length))}
                    aria-label="Generate image"
                    aria-busy={busy}
                    aria-describedby={busy || promptEmpty || (source === "api" && (!model || !sizes.length)) ? "generate-disabled-reason" : undefined}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <ArrowUp size={20} />
                    )}
                  </Button>
                </div>
              </form>
              {source === "api" && model && !sizes.length && <p className="field-error" role="status">{unavailableSizeMessage}</p>}
              {source === "api" && sizeFallback?.after === size && (
                <p className="text-muted-foreground" role="status">
                  This model does not support {ratioFirstLabel(sizeFallback.before)}. Using {ratioFirstLabel(size)}.
                </p>
              )}
              {sizeAdaptation && <p className="text-muted-foreground" role="status">{sizeAdaptation}</p>}
              <div className="composer-hint">
                <span className="composer-attribution">
                  {source === "queue"
                    ? "Generated by your Codex workers"
                    : "Generated with your provider account"}
                  {projectId && (
                    <>
                      {" "}
                      in{" "}
                      <strong>
                        {data.projects.find(item => item.id === projectId)?.name}
                      </strong>
                    </>
                  )}
                </span>
                <span className="composer-shortcut">⌘ Enter</span>
              </div>
            </div>
          </>
        )}
      </main>
      <FirstGenerationCelebration jobs={data.jobs} loaded={loaded} blocked={Boolean(settings || newProject || selected || library)} />
      {notice &&
        !(settings || newProject || selected || library) && (
          <Notification message={notice} onDismiss={() => setNotice("")}
            action={notice === "Connect this provider in Settings first"
              ? <a href="/settings#provider-connection" className={buttonVariants({ variant: "outline", size: "sm" })}>Open settings</a>
              : undoId && notice === undoNotice ? <Button variant="outline" size="sm" disabled={undoBusy} onClick={() => void undoLastRetention()}>Undo</Button> : undefined}
          />
        )}
      <Dialog open={newProject} onOpenChange={(open) => {
        if (!open) pendingReferenceDrop.current = null;
        setNewProject(open);
      }}>
        <DialogContent>
          {notice && (
            <p className="field-error" role="status">
              {notice}
            </p>
          )}
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Keep related images and references together.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (creatingProjectPending.current) return;
                creatingProjectPending.current = true;
                setCreatingProject(true);
                const result = await createProjectAction({ name: projectName, directory: projectDirectory.trim() || undefined });
                showError(result);
                if (result?.data) {
                  setProject(result.data.id);
                  setNewProject(false);
                  setProjectName("");
                  setProjectDirectory("");
                  const drop = pendingReferenceDrop.current;
                  pendingReferenceDrop.current = null;
                  await refresh();
                  if (drop) await attachReferences(drop.jobs, drop.files, result.data.id);
                }
              } catch (e) {
                setNotice((e as Error).message);
              } finally { creatingProjectPending.current = false; setCreatingProject(false); }
            }}
          >
            <div className="field">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={projectName}
                disabled={creatingProject}
                onChange={(e) => setProjectName(e.target.value)}
                autoFocus
                required
                maxLength={100}
              />
            </div>
            {!data.cloud && <div className="field">
              <Label htmlFor="project-directory">Project folder</Label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Input id="project-directory" value={projectDirectory} onChange={event => setProjectDirectory(event.target.value)} placeholder="Create automatically" aria-describedby="project-directory-help" maxLength={4096} disabled={creatingProject} />
                <Button type="button" variant="outline" disabled={pickingDirectory !== null || creatingProject} onClick={() => void chooseDirectory("project")}>{pickingDirectory === "project" ? "Choosing folder…" : "Choose folder…"}</Button>
              </div>
              <p id="project-directory-help">Images, references and project data are saved here. Leave empty to create a separate folder automatically.</p>
            </div>}
            <Button type="submit" disabled={!projectName.trim() || creatingProject || pickingDirectory !== null}>
              {creatingProject ? "Creating project…" : "Create project"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selected}
        onOpenChangeComplete={(open) => { if (!open) closingDetail.current = null; }}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="detail-dialog" initialFocus={() => document.querySelector<HTMLButtonElement>(".detail-dialog [data-slot=dialog-close]") ?? true} finalFocus={() => {
          if (focusComposerAfterDetail.current) {
            focusComposerAfterDetail.current = false;
            return promptInput.current ?? true;
          }
          if (!directDetailFocus.current) return true;
          directDetailFocus.current = false;
          return galleryHeading.current ?? true;
        }}>
          <DialogHeader className="image-detail-header">
            <Tooltip label={detailJob ? title(detailJob) : "Image details"}><DialogTitle className="image-detail-title">
              {detailJob ? <><span className="image-detail-project">{data.projects.find(item => item.id === detailJob.projectId)?.name ?? "Inbox"}
                {detailJob.topicId && <> / {data.topics?.find(item => item.id === detailJob.topicId)?.name}</>}</span>
                <span className="image-detail-separator" aria-hidden="true"> / </span>
                <strong className="image-detail-filename" aria-label={detailJob.originalName || title(detailJob)}><span className="detail-filename-full" aria-hidden="true">{detailJob.originalName || title(detailJob)}</span><span className="detail-filename-mobile" aria-hidden="true">{(() => { const name = detailJob.originalName || title(detailJob); return name.length > 28 ? `${name.slice(0, 15)}…${name.slice(-10)}` : name; })()}</span></strong></> : "Image details"}
            </DialogTitle></Tooltip>
            <DialogDescription>
              {detailJob && detailJob.status !== "done" ? (isReserved(detailJob) ? "Reserved" : labels[detailJob.status]) : ""}
              {detailJob?.stackId && detailVersionIndex >= 0 && <span className="detail-version-label">v{detailJob.versionNumber ?? detailVersionIndex + 1} of {nextVersionNumber - 1}</span>}
            </DialogDescription>
            {detailJob && detailIndex >= 0 && <span className="image-detail-counter" aria-label="Image position">{detailIndex + 1} of {detailSequence.length}</span>}
          </DialogHeader>
          {detailJob && (
            <div className="detail-layout">
              <div
                className={`detail-preview ${detailJob.status !== "done" ? "detail-preview-pending" : ""} ${detailJob.transparent ? "checker" : ""}`}
                onPointerCancel={event => { if (annotationStart.current?.pointerId === event.pointerId) { annotationStart.current = undefined; setNotePoint(undefined); } }}
                onLostPointerCapture={event => { if (annotationStart.current?.pointerId === event.pointerId) { annotationStart.current = undefined; setNotePoint(undefined); } }}
                onPointerDown={(event) => {
                  if (annotationStart.current || event.button !== 0 || detailJob.status !== "done" || detailJob.archivedAt || detailJob.trashedAt || savingNote) return;
                  const image =
                    event.currentTarget.querySelector(".progressive-image");
                  if (!image) return;
                  const box = image.getBoundingClientRect();
                  annotationStart.current = {
                    pointerId: event.pointerId,
                    x: Math.max(
                      0,
                      Math.min(1, (event.clientX - box.left) / box.width),
                    ),
                    y: Math.max(
                      0,
                      Math.min(1, (event.clientY - box.top) / box.height),
                    ),
                  };
                  setNotePoint({ x: annotationStart.current.x, y: annotationStart.current.y });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const start = annotationStart.current;
                  if (!start || start.pointerId !== event.pointerId) return;
                  const image = event.currentTarget.querySelector(".progressive-image");
                  if (!image) return;
                  const box = image.getBoundingClientRect();
                  if (!box.width || !box.height) return;
                  setNotePoint(annotationSelection(start, {
                    x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
                    y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
                  }));
                }}
                onPointerUp={(event) => {
                  const start = annotationStart.current;
                  const image =
                    event.currentTarget.querySelector(".progressive-image");
                  if (!start || start.pointerId !== event.pointerId || !image) return;
                  const box = image.getBoundingClientRect();
                  const x = Math.max(
                      0,
                      Math.min(1, (event.clientX - box.left) / box.width),
                    ),
                    y = Math.max(
                      0,
                      Math.min(1, (event.clientY - box.top) / box.height),
                    );
                  setNotePoint(annotationSelection(start, { x, y }));
                  annotationStart.current = undefined;
                  nextVersionInput.current?.focus();
                }}
              >
                <Button className="image-nav image-nav-previous" variant="outline" size="icon" aria-label="Previous image" disabled={!previousImage} onPointerDown={event => event.stopPropagation()} onClick={() => previousImage && setSelected(previousImage)}><ChevronLeft size={20} /></Button>
                <Button className="image-nav image-nav-next" variant="outline" size="icon" aria-label="Next image" disabled={!nextImage} onPointerDown={event => event.stopPropagation()} onClick={() => nextImage && setSelected(nextImage)}><ChevronRight size={20} /></Button>
                {detailJob.status === "done" ? (
                  <ImagePreview
                    job={detailJob}
                    selection={notePoint}
                    onNoteSelect={setActiveNote}
                    notes={(data.notes ?? []).filter(
                      (note) => note.imageId === detailJob.id,
                    )}
                    neighbors={[previousImage, nextImage].filter((job): job is Job => Boolean(job))}
                  />
                ) : (
                  <div className="pending-art detail-pending-art" style={{ aspectRatio: `${detailJob.width}/${detailJob.height}`, width: `min(100%, calc((100dvh - 160px) * ${detailJob.width / detailJob.height}))` }} role="status">
                    {detailJob.status === "uncertain" ? <Question size={32} />
                      : ["blocked", "failed"].includes(detailJob.status) ? <Warning size={32} />
                      : detailJob.status === "running" ? <LoaderCircle size={32} className="spin" />
                      : <Clock3 size={32} />}
                    <strong>{isReserved(detailJob) ? "Reserved" : labels[detailJob.status]}</strong>
                    {detailJob.status === "uncertain" ? <p>Generation was interrupted. The image may or may not exist.</p> : detailJob.error && <p>{detailJob.error}</p>}
                  </div>
                )}
              </div>
              <div className="detail-info">
                <div className="detail-info-scroll">
                {notice && <p className="detail-notice" role="status">{notice}</p>}
                {(detailJob.archivedAt || detailJob.trashedAt) && <div className="retention-notice" role="status">
                  <span>{detailJob.trashedAt ? "This image is in Trash" : "This image is archived"}</span>
                  <Button variant="outline" onClick={async () => {
                    try {
                      const result=await retentionAction({ids:[detailJob.id],operation:"restore",includeStack:false});showError(result);
                      if(result?.data?.undoId) {
                        setUndoHistory(history=>[...history,result.data!.undoId]);
                        // This restore has no notice of its own; a showing notice's Undo must not revert it.
                        setUndoNotice(undefined);
                      }
                      const state = await refresh();
                      setSelected(current => current?.id === detailJob.id
                        ? state.jobs.find((job: Job) => job.id === detailJob.id) ?? null
                        : current);
                    } catch(error){setNotice((error as Error).message);}
                  }}>Restore</Button>
                </div>}

                <section className="detail-prompt">
                  <div className="detail-prompt-heading">
                    <Label>{detailJob.imported ? "File" : "Prompt"}</Label>
                    {detailJob.prompt.length > 240 && <Button variant="ghost" size="sm" aria-expanded={promptExpanded} onClick={() => setPromptExpanded(value => !value)}>{promptExpanded ? "Show less" : "Show all"}</Button>}
                    <CopyButton value={detailJob.prompt} label="Copy prompt"
                      onSuccess={() => setNotice("Prompt copied")}
                      onError={() => setNotice("Unable to copy prompt")} />
                  </div>
                  <ExpandablePrompt expanded={promptExpanded} text={detailJob.imported && !detailJob.prompt ? "Imported, no prompt" : detailJob.prompt} />
                  <p className="detail-metadata">{detailJob.imported ? "Imported" : detailJob.source === "queue" ? "Codex queue" : providerLabels[detailJob.provider]}{!detailJob.imported && detailJob.model && ` · ${detailJob.model}`}</p>
                  <p className="detail-metadata">{detailJob.width} × {detailJob.height}{(!detailJob.imported || detailJob.opacityVerified) && <> · {detailJob.transparent ? "Transparent" : "Opaque"}</>} · {new Date(detailJob.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
                  {detailJob.exactDimensions === false && detailJob.aspectRatio &&
                    <p className="detail-metadata">Requested aspect ratio · {detailJob.aspectRatio}</p>}
                  {detailJob.resolution &&
                    <p className="detail-metadata">Requested resolution · {detailJob.resolution}</p>}
                  {detailJob.exactDimensions !== false && detailJob.requestedSize &&
                    (detailJob.requestedSize.width !== detailJob.width || detailJob.requestedSize.height !== detailJob.height) &&
                    <p className="detail-metadata">Requested size · {detailJob.requestedSize.width} × {detailJob.requestedSize.height}</p>}
                  {detailJob.providerResultSize &&
                    (detailJob.providerResultSize.width !== detailJob.width || detailJob.providerResultSize.height !== detailJob.height) &&
                    <p className="detail-metadata">Provider output · {detailJob.providerResultSize.width} × {detailJob.providerResultSize.height}</p>}
                </section>

                {(data.topics?.some(topic => topic.projectId === detailJob.projectId && !topic.deleted) ?? false) && (
                  <div className="field">
                    <Label>Topic</Label>
                    <SelectInput
                      label="Move image to topic"
                      value={detailJob.topicId ?? ""}
                      placeholder="Choose topic"
                      options={(data.topics ?? []).filter(topic => topic.projectId === detailJob.projectId && !topic.deleted).map((t) => ({
                        value: t.id,
                        label: t.name,
                      }))}
                      onValueChange={async (topicId) => {
                        try {
                          showError(await moveToTopicAction({ ids: [detailJob.id], topicId }));
                          setSelected(current => current?.id === detailJob.id ? { ...current, topicId } : current);
                          await refresh();
                        } catch (error) {
                          setNotice((error as Error).message);
                        }
                      }}
                    />
                  </div>
                )}
                <div className="detail-organization flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm"
                  aria-expanded={tagEditorId === detailJob.id}
                  onClick={() => {
                    setTagEditorId(tagEditorId === detailJob.id ? "" : detailJob.id);
                  }}>
                  Tags<Badge variant="secondary" className="min-w-5 px-1.5 tabular-nums">{detailJob.tags?.filter(tag => tag.source !== "agent").length ?? 0}</Badge>
                  {detailJob.tags?.some(tag => tag.source === "agent") && <span className="tag-suggestion-dot" role="img" aria-label="Tag suggestions waiting" />}
                </Button>
                  <SelectInput
                    id="move-project"
                    label="Project"
                    className="min-w-0 max-w-full"
                    value={detailJob.projectId}
                    onValueChange={async (projectId) => {
                      try {
                        showError(
                          await moveJobAction({ id: detailJob.id, projectId }),
                        );
                        setSelected({ ...detailJob, projectId, topicId: undefined });
                        await refresh();
                      } catch (error) {
                        setNotice((error as Error).message);
                      }
                    }}
                    options={data.projects.map((project) => ({
                      value: project.id,
                      label: project.name,
                    }))}
                  />
                </div>
                {tagEditorId === detailJob.id && <ImageTags key={`tags-${detailJob.id}`} job={detailJob}
                  onUpdated={updated => {
                    setSelected(current => current?.id === updated.id ? updated : current);
                    void refresh().catch(error => setNotice((error as Error).message));
                  }} />}
                {detailJob.stackId && (
                  <div className="version-list">
                    <Label>Versions</Label>
                    <div ref={versionStrip} className="version-thumbnails" role="group" aria-label="Image versions">
                    {detailVersions.map((job, index) => (
                        <Button
                          key={job.id}
                          variant={
                            job.id === detailJob.id ? "default" : "outline"
                          }
                          className="version-thumbnail"
                          aria-label={`Version ${job.versionNumber ?? index + 1}${job.isMain ? ", main image" : ""}`}
                          aria-pressed={job.id === detailJob.id}
                          onClick={() => setSelected(job)}
                        >
                          {job.status === "done" && <img src={`/api/asset?job=${encodeURIComponent(job.id)}&thumb=160`} alt="" loading="lazy" decoding="async" />}
                          <span>v{job.versionNumber ?? index + 1}{job.isMain ? " · Main" : ""}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <ImageNotes key={detailJob.id} notes={(data.notes ?? []).filter(note => note.imageId === detailJob.id)} activeId={activeNote ?? ""} />
                <div className="detail-actions">
                  {detailJob.status === "done" && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await receiveReferences([detailJob], []);
                          focusComposerAfterDetail.current = true;
                          setSelected(null);
                        } catch (error) {
                          setNotice((error as Error).message);
                        }
                      }}
                    >
                      <ImageIcon size={15} /> Use as reference
                    </Button>
                  )}
                  {(detailJob.status === "done" || (detailJob.status === "blocked" && detailJob.blobKey)) && (
                    <Tooltip label="Download"><Button
                      variant="outline"
                      size="icon"
                      aria-label="Download"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = asset(detailJob, false);
                        a.download = `${detailJob.id}.png`;
                        a.click();
                      }}
                    >
                      <Download size={15} />
                    </Button></Tooltip>
                  )}
                  {detailJob.status === "queued" && !detailJob.outputPath && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          showError(await cancelAction({ id: detailJob.id }));
                          setSelected(null);
                          await refresh();
                        } catch (e) {
                          setNotice((e as Error).message);
                        }
                      }}
                    >
                      Cancel request
                    </Button>
                  )}
                  <DropdownMenu>
                    <Tooltip label="More actions"><DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More" />}> <DotsThree size={20} /></DropdownMenuTrigger></Tooltip>
                    <DropdownMenuContent side="top">
                    {detailJob.claim && <p className="max-w-60 break-all px-3 py-2 text-xs text-muted-foreground">Reserved by {detailJob.claim.owner} since {reservationTime(detailJob.claim.since, healthNow)}</p>}
                  <DropdownMenuItem
                    onClick={() => {
                      form.setValue("prompt", detailJob.prompt);
                      setSize(`${detailJob.width}x${detailJob.height}`);
                      setTransparent(detailJob.transparent);
                      setDestination(detailJob.projectId);
                      setDestinationTopic(detailJob.topicId ?? "");
                      setSource(detailJob.source);
                      setProvider(detailJob.provider);
                      setModel(detailJob.model);
                      setResolution(detailJob.resolution ?? "");
                      setCustomDimensionsSelected(detailJob.exactDimensions !== false);
                      setRefs(detailJob.referenceIds);
                      requestKey.current = crypto.randomUUID();
                      setComposerExpanded(true);
                      setComposerCollapsed(false);
                      setSelected(null);
                      requestAnimationFrame(() => promptInput.current?.focus());
                    }}
                  >
                    <Sparkles size={15} />{" "}
                    {["blocked", "failed"].includes(detailJob.status)
                      ? "Prepare new attempt"
                      : "Reuse prompt"}
                  </DropdownMenuItem>
                  {!data.cloud && detailJob.source === "queue" && detailJob.status === "done" && detailJob.outputPath && (
                    <DropdownMenuItem onClick={async () => {
                      try { showError(await revealQueueImageAction({ id: detailJob.id })); }
                      catch (error) { setNotice((error as Error).message); }
                    }}>
                      <Folder size={15} /> Show in Finder
                    </DropdownMenuItem>
                  )}
                  {detailJob.status === "done" && !detailJob.stackId && <DropdownMenuItem onClick={() => {setStackSearch("");setStackLimit(60);setStackError("");setStackPicker(true);}}>Add to a version stack…</DropdownMenuItem>}
                  {detailJob.status === "done" && <DropdownMenuItem onClick={async () => {
                    try {
                      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image copying is unavailable in this browser");
                      const response = await fetch(asset(detailJob, false));
                      if (!response.ok) throw new Error("Could not load image");
                      const blob = await response.blob();
                      if (!ClipboardItem.supports(blob.type)) throw new Error("This image format cannot be copied. Use Download instead.");
                      await navigator.clipboard.write([new ClipboardItem({[blob.type]:blob})]);
                      setNotice("Image copied");
                    } catch (error) {setNotice((error as Error).message);}
                  }}>Copy image</DropdownMenuItem>}
                  {detailJob.stackId && detailJob.status === "done" && !detailJob.isMain && !detailJob.archivedAt && !detailJob.trashedAt && (
                    <DropdownMenuItem onClick={async () => {
                      try {
                        showError(await mainVersionAction({id:detailJob.id}));
                        const state = await refresh();
                        setSelected(current => current?.id === detailJob.id ? state.jobs.find(job => job.id === detailJob.id) ?? null : current);
                      } catch (error) {setNotice((error as Error).message);}
                    }}>Use as main image</DropdownMenuItem>
                  )}
                  {!["queued", "running"].includes(detailJob.status) && !detailJob.trashedAt && <DropdownMenuSeparator />}
                  {!["queued", "running"].includes(detailJob.status) && !detailJob.trashedAt &&
                    (detailJob.archivedAt ? ["trash"] : ["archive", "trash"]).map(operation => (
                      <DropdownMenuItem key={operation} onClick={() => void retainDetail(detailJob, operation as "archive" | "trash")}>
                        {operation === "archive" ? "Archive image" : "Move image to trash"}
                        <DropdownMenuShortcut>{operation === "archive" ? "E" : "Delete"}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {detailJob.outputPath && <OutputPath path={detailJob.outputPath} onNotice={setNotice} />}
                </div>
                {detailJob.status === "done" && <div className="next-version field">
                  <Label htmlFor="next-version">Next version{notePoint ? " · Selected area" : ""}</Label>
                  <Textarea maxLength={notePoint ? 4000 : 12000} disabled={savingNote || detailJob.status !== "done" || Boolean(detailJob.archivedAt || detailJob.trashedAt)} ref={nextVersionInput} id="next-version" value={iterationPrompt} onChange={event => setIterationPrompt(event.target.value)}
                    placeholder="Describe what should change"
                    onKeyDown={async event => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing || noteSavePending.current) return;
                      if (event.metaKey || event.ctrlKey) {event.preventDefault();void requestCorrection(detailJob,iterationPrompt);return;}
                      if (!event.shiftKey && iterationPrompt.trim()) {
                        event.preventDefault();
                        await saveImageNote(detailJob);
                      }
                    }} />
                  {savingNote && <p role="status">Saving note…</p>}
                  <div className="next-version-source">
                    <div className="field">
                      <Label htmlFor="next-version-source">Source</Label>
                      <SelectInput id="next-version-source" label="Next version source" value={source}
                        onValueChange={value => setSource(value as typeof source)}
                        options={[{value:"queue",label:"Codex queue",disabled:data.cloud},{value:"api",label:"Your API key · OpenAI"}]} />
                    </div>
                    {source === "api" && !correctionNeedsConnection && <div className="field">
                      <Label htmlFor="next-version-model">Model</Label>
                      <SelectInput id="next-version-model" label="Next version model" value={model}
                        onValueChange={value => {setModel(value);setResolution("");}}
                        placeholder="Connect OpenAI in Settings"
                        options={models.map(item => ({value:item.id,label:item.name,disabled:!item.references}))} />
                    </div>}
                  </div>
                  <WorkerAlert enabled={source === "queue"} unavailable={workersUnavailable}
                    instantHeight={priorComposerSource.current !== source}
                    message={queueVersionNotice ?? ""}
                    manageHref="/settings#worker-pool" />
                  {correctionNeedsConnection ? <>
                    <p className="text-muted-foreground" role="status">Connect OpenAI to edit this image with your API key.</p>
                    <Button onClick={() => router.push("/settings?provider=openai")}>Connect OpenAI in Settings</Button>
                  </> : <>
                  {correctionSourceError && <p className="text-muted-foreground" role="status">{correctionSourceError}</p>}
                  <Button disabled={savingNote || busy || Boolean(correctionSourceError) || detailJob.status !== "done" || Boolean(detailJob.archivedAt || detailJob.trashedAt) || (!iterationPrompt.trim() && !(data.notes ?? []).some(note => note.imageId === detailJob.id && !note.sentInJobId))}
                    onClick={() => void requestCorrection(detailJob,iterationPrompt)}>{detailJob.stackId ? `Request v${nextVersionNumber}` : "Request next version"}</Button>
                  </>}
                </div>}
                {isReserved(detailJob) && <div className="detail-recovery field">
                  <p>Reserved by {detailJob.claim?.owner} since {reservationTime(detailJob.claim?.since, healthNow)}.</p>
                  {reservationReviewId !== detailJob.id ? <Button variant="outline" onClick={()=>setReservationReviewId(detailJob.id)}>Review reservation</Button> : <>
                    <p>The worker may still be generating. Continue only after checking its chat. The original reservation will be kept.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={()=>setReservationReviewId(undefined)}>Cancel</Button>
                      <Button disabled={busy} onClick={async()=>{setBusy(true);try{const result=await inspectReservationAction({id:detailJob.id,acknowledgeUncertain:true});showError(result);if(result?.data)setSelected(result.data);setReservationReviewId(undefined);await refresh();}catch(error){setNotice((error as Error).message);}finally{setBusy(false);}}}>Review as uncertain</Button>
                    </div>
                  </>}
                </div>}
                {["blocked", "failed", "uncertain"].includes(detailJob.status) && !detailJob.archivedAt && !detailJob.trashedAt && <div className="detail-recovery field">
                  {detailJob.status === "uncertain" && <p>{detailJob.source === "queue" ? "Retrying may use your plan limit again." : "Retrying may be charged again."}</p>}
                  <Button disabled={busy} aria-busy={detailPendingRecovery === "retry" || undefined} onClick={async () => {
                    setBusy(true);
                    setPendingRecovery({ jobId: detailJob.id, action: "retry" });
                    try {
                      const result = await retryImageAction({id:detailJob.id,acknowledgeUncertain:detailJob.status === "uncertain"});
                      showError(result);
                      if (!result?.data) throw new Error("Retry returned no result");
                      setSelected(result.data);
                      await refresh();
                    } catch (error) {setNotice((error as Error).message);}
                    finally {setPendingRecovery(undefined);setBusy(false);}
                  }}>{detailPendingRecovery === "retry" ? "Retrying…" : detailJob.status === "uncertain" ? (detailJob.source === "queue" ? "Retry (may use your plan limit again)" : "Retry (may be charged again)") : "Retry"}</Button>
                  {detailJob.error && /referenc|missing.*(?:image|file)/i.test(detailJob.error) && <Button variant="outline" disabled={busy} onClick={() => {
                    form.setValue("prompt",detailJob.prompt);
                    setDestination(detailJob.projectId);
                    setDestinationTopic(detailJob.topicId ?? "");
                    setSource(detailJob.source);setProvider(detailJob.provider);setModel(detailJob.model);
                    setSize(`${detailJob.width}x${detailJob.height}`);setTransparent(detailJob.transparent);
                    setCustomDimensionsSelected(detailJob.exactDimensions !== false);setResolution(detailJob.resolution ?? "");
                    setRefs(detailJob.referenceIds.filter(id=>data.references.some(ref=>ref.id===id)));
                    requestKey.current=crypto.randomUUID();setComposerCollapsed(false);setComposerExpanded(true);setSelected(null);
                    requestAnimationFrame(()=>fileInput.current?.click());
                  }}><Paperclip size={16} />Attach reference</Button>}
                  {detailJob.status === "uncertain" && <>
                    <Button variant="outline" disabled={busy} aria-busy={detailPendingRecovery === "mark-failed" || undefined} onClick={async () => {
                      setBusy(true);
                      setPendingRecovery({ jobId: detailJob.id, action: "mark-failed" });
                      try {const result=await markUncertainFailedAction({id:detailJob.id});showError(result);if(result?.data)setSelected(result.data);await refresh();}
                      catch(error){setNotice((error as Error).message);}
                      finally{setPendingRecovery(undefined);setBusy(false);}
                    }}>Mark as failed</Button>
                    {detailJob.source === "api" && <a className={buttonVariants({ variant: "outline" })} href={detailJob.provider === "openai" ? "https://platform.openai.com/usage" : detailJob.provider === "openrouter" ? "https://openrouter.ai/activity" : detailJob.provider === "google" ? "https://aistudio.google.com/" : "https://vercel.com/dashboard"} target="_blank" rel="noreferrer">Open provider dashboard</a>}
                  </>}
                </div>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={stackPicker && !!selected} onOpenChange={setStackPicker}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Add to a version stack</DialogTitle><DialogDescription>Choose the image this version follows.</DialogDescription></DialogHeader>
          {stackError && <p role="alert" className="field-error">{stackError}</p>}
          <Input aria-label="Search parent images" placeholder="Search images…" value={stackSearch} onChange={event => {setStackSearch(event.target.value);setStackLimit(60);}} />
          {stackCandidates.length === 0 && <p role="status">No matching images</p>}
          <div className="stack-picker-grid">
            {stackCandidates.slice(0,stackLimit).map(job => {
              const item = <Button key={job.id} variant="outline" className="stack-picker-item" aria-label={job.originalName || job.prompt || title(job)} disabled={joiningStack} onClick={async () => {
                if (!selected || stackJoinPending.current) return;
                stackJoinPending.current = true;
                setJoiningStack(true);
                setStackError("");
                try {
                  const result = await joinStackAction({parentId:job.id,versionId:selected.id});
                  showError(result);
                  if (result.data) setSelected(result.data);
                  setStackPicker(false);
                  await refresh();
                } catch (error) {setStackError((error as Error).message);}
                finally {stackJoinPending.current = false;setJoiningStack(false);}
              }}>
                <img src={`/api/asset?job=${encodeURIComponent(job.id)}&thumb=160`} srcSet={`/api/asset?job=${encodeURIComponent(job.id)}&thumb=160 160w, /api/asset?job=${encodeURIComponent(job.id)}&thumb=320 320w`} sizes="160px" alt="" loading="lazy" decoding="async" />
                <span>{job.originalName || title(job)}</span>
                <span className="stack-picker-meta">{new Date(job.createdAt).toLocaleDateString()}</span>
              </Button>;
              return job.prompt ? <Tooltip key={job.id} label={job.prompt}>{item}</Tooltip> : item;
            })}
          </div>
          {stackCandidates.length > stackLimit && <Button variant="outline" onClick={() => setStackLimit(limit => limit + 60)}>Show more images</Button>}
        </DialogContent>
      </Dialog>
      <Dialog open={purgeIds.length > 0} onOpenChange={open => {if (!open && !purging) setPurgeIds([]);}}>
        <DialogContent showCloseButton={false} initialFocus={purgeCancel}>
          <DialogHeader>
            <DialogTitle>Delete {purgeIds.length} {purgeIds.length === 1 ? "image" : "images"} permanently?</DialogTitle>
            <DialogDescription>This removes the selected records and unshared files stored by image-queue. {data.cloud ? "External files stay on disk." : "External files stay on disk by default."} This cannot be undone.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
            <dt>Records with stored images</dt><dd>{purgeSummary.stored}</dd>
            <dt>Records with external images</dt><dd>{purgeSummary.external}</dd>
            <dt>Requests without images</dt><dd>{purgeSummary.withoutImage}</dd>
          </dl>
          {!data.cloud && purgeSummary.external > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox id="purge-external-output" checked={removeExternal} disabled={purging} onCheckedChange={setRemoveExternal} />
              <Label htmlFor="purge-external-output">Also delete external image files from this machine</Label>
            </div>
          )}
          {(purging || purgeProgress.processed > 0) && <div className="purge-progress">
            <Progress value={purgeProgress.processed} max={purgeProgress.processed + purgeIds.length} label="Permanently deleting images" />
            <p role="status">Processed {purgeProgress.processed} of {purgeProgress.processed + purgeIds.length} images.</p>
          </div>}
          {purgeError && <p role="alert" className="field-error">{purgeError}</p>}
          <DialogFooter>
          <Button ref={purgeCancel} variant="outline" disabled={purging} onClick={() => setPurgeIds([])}>Cancel</Button>
          <Button variant="outline" className="purge-confirm" disabled={purging} onClick={async () => {
            if (purgePending.current) return;
            purgePending.current = true;
            setPurging(true);
            try {
              let { processed, deleted } = purgeProgress;
              let remaining = purgeIds;
              while (remaining.length > 0) {
                const result = await purgeAction({ ids: remaining.slice(0, 1000), ...(!data.cloud && removeExternal ? { removeExternal: true } : {}) });
                showError(result);
                deleted += result?.data?.deleted.length ?? 0;
                processed += Math.min(remaining.length, 1000);
                remaining = remaining.slice(1000);
                setPurgeProgress({ processed, deleted });
                setPurgeIds(remaining);
              }
              setNotice(`${deleted} images permanently deleted`);
              setSelectedIds([]);
              await refresh();
            } catch(error) {setPurgeError((error as Error).message);}
            finally {purgePending.current = false;setPurging(false);}
          }}>{purging ? "Deleting…" : "Delete permanently"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={customSize} onOpenChange={setCustomSize}>
        <DialogContent showCloseButton={false} finalFocus={() => document.getElementById("composer-image-size")}><DialogHeader><DialogTitle>Custom image size</DialogTitle><DialogDescription>Exact output dimensions in pixels, from 256 to 4096 per side.</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={event => {event.preventDefault();const width=Number(customWidth),height=Number(customHeight);if(!Number.isInteger(width)||!Number.isInteger(height)||width<256||height<256||width>4096||height>4096){setCustomSizeError("Enter whole numbers from 256 to 4096 for both dimensions.");return;}if(customRatio !== "free"){const [a,b]=customRatio.split(":").map(Number);if(width*b !== height*a){const suggested = closestCustomDimensions(width, customRatio, source === "api" ? selectedSizeProfile : undefined);setCustomSizeError(suggested ? `These whole-pixel dimensions do not match the selected ratio exactly. Try ${suggested.width} × ${suggested.height} or choose Free dimensions.` : "The selected model does not support this proportion. Choose another proportion or model.");return;}}if(source === "api" && selectedSizeProfile){try{resolveModelSize(selectedSizeProfile,{width,height});}catch(error){setCustomSizeError((error as Error).message);return;}}setSavedCustomSizes(current => rememberCustomSize(current, `${width}x${height}`));setSize(`${width}x${height}`);setCustomDimensionsSelected(true);setSizeFallback(null);setCustomSize(false);}}>
            <div className="field">
              <Label htmlFor="custom-ratio">Aspect ratio</Label>
              <SelectInput id="custom-ratio" label="Custom aspect ratio" side="bottom" contentClassName="max-h-[min(var(--available-height),13rem)]" value={customRatio}
                options={[{value:"free",label:"Free dimensions"}, ...aspectRatios.map(value=>({value,label:value}))]}
                onValueChange={value => {
                  setCustomRatio(value);
                  setCustomSizeError("");
                  if(value !== "free") {
                    const dimensions = closestCustomDimensions(Number(customWidth), value, source === "api" ? selectedSizeProfile : undefined);
                    if (!dimensions) {
                      setCustomSizeError("The selected model does not support this proportion. Choose another proportion or model.");
                      return;
                    }
                    setCustomWidth(String(dimensions.width));
                    setCustomHeight(String(dimensions.height));
                  }
                }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
            <div className="field min-w-0"><Label htmlFor="custom-width">Width</Label><Input id="custom-width" type="number" min={256} max={4096} required value={customWidth} onChange={event=>{
              setCustomWidth(event.target.value);
              setCustomSizeError("");
              if(customRatio !== "free" && event.target.value) {
                const [a,b] = customRatio.split(":").map(Number);
                setCustomHeight(String(Math.round(Number(event.target.value) * b / a)));
              }
            }} /></div>
            <div className="field min-w-0"><Label htmlFor="custom-height">Height</Label><Input id="custom-height" type="number" min={256} max={4096} required value={customHeight} onChange={event=>{
              setCustomHeight(event.target.value);
              setCustomSizeError("");
              if(customRatio !== "free" && event.target.value) {
                const [a,b] = customRatio.split(":").map(Number);
                setCustomWidth(String(Math.round(Number(event.target.value) * a / b)));
              }
            }} /></div>
            </div>
            {Number(customWidth) > 0 && Number(customHeight) > 0 && <p className="text-muted-foreground" aria-live="polite">{ratioFirstLabel(`${customWidth}x${customHeight}`)}</p>}
            {customSizeError && <p role="alert" className="field-error">{customSizeError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCustomSize(false)}>Cancel</Button>
              <Button type="submit">Apply size</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={newTopic} onOpenChange={(open) => {
        setNewTopic(open);
        if (!open) setTopicError("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New topic</DialogTitle>
            <DialogDescription>
              Group a thread of image requests inside this project.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setTopicError("");
              try {
                const result = await createTopicAction({
                  projectId: project,
                  name: topicName,
                });
                showError(result);
                setNewTopic(false);
                setTopicName("");
                await refresh();
              } catch (error) {
                setTopicError((error as Error).message);
              }
            }}
          >
            <div className="field">
              <Label htmlFor="topic-name">Topic name</Label>
              <Input
                id="topic-name"
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
                aria-invalid={topicError ? true : undefined}
                aria-describedby={topicError ? "topic-name-error" : undefined}
                required
                maxLength={100}
              />
              {topicError && <p id="topic-name-error" role="alert" className="field-error break-words">{topicError}</p>}
            </div>
            <Button type="submit" className="justify-self-start" disabled={!topicName.trim()}>
              Create topic
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={library} onOpenChange={setLibrary}>
        <DialogContent {...referenceDropHandlers} className="reference-drop-zone">
          {notice && (
            <p className="field-error" role="status">
              {notice}
            </p>
          )}
          <DialogHeader>
            <DialogTitle>Reference library</DialogTitle>
            <DialogDescription>
              Choose a saved reference, drop or paste an image here, or use a ready image from the gallery.
            </DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} /> Upload reference
          </Button>
          <p className="reference-selection-count" role="status" aria-live="polite">
            {refs.length} of 10 selected{refs.length >= 10 ? " · Remove a reference to add another." : ""}
          </p>
          <div className="reference-library">
            {data.references
              .filter((r) => r.projectId === projectId && r.kind === "image")
              .map((ref) => {
                return (
                  <Button
                    key={ref.id}
                    variant="outline"
                    className="reference-choice"
                    aria-pressed={refs.includes(ref.id)}
                    disabled={refs.length >= 10 && !refs.includes(ref.id)}
                    onClick={() => {
                        setRefs((previous) =>
                          previous.includes(ref.id)
                            ? previous.filter((id) => id !== ref.id)
                            : [...previous, ref.id],
                      );
                    }}
                  >
                      <img
                        src={`/api/asset?key=${encodeURIComponent(ref.blobKey)}`}
                        alt=""
                      />
                    <span>{ref.name}</span>
                    {refs.includes(ref.id) && <Check size={14} />}
                  </Button>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
