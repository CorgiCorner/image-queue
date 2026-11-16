// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Gallery, imageUrl } from "../src/components/gallery";
import { ImagePreview } from "../src/components/image-preview";
import type { Job } from "../src/core/schema";

const jobs = Array.from(
  { length: 10000 },
  (_, i) =>
    ({
      id: String(i),
      prompt: `Image ${i}`,
      width: 1024,
      height: i % 2 ? 1024 : 1536,
      status: i % 3 ? "done" : "running",
      source: "queue",
      transparent: i % 2 === 0,
    }) as Job,
);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 1000 } }]);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    fn();
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("rectangle gallery", () => {
  it.each(["justified", "masonry", "grid"] as const)("bounds DOM nodes with ten thousand items in %s and opens a result", (mode) => {
    const open = vi.fn();
    const { container, rerender } = render(
      <Gallery
        jobs={jobs}
        mode={mode}
        onOpen={open}
        selectedIds={[]}
        onSelection={() => {}}
      />,
    );
    const buttons = container.querySelectorAll("button");
    rerender(
      <Gallery
        jobs={jobs.slice(0, 1000)}
        mode={mode}
        onOpen={open}
        selectedIds={[]}
        onSelection={() => {}}
      />,
    );
    expect(container.querySelectorAll("button").length).toBe(buttons.length);
    expect(buttons.length).toBeLessThan(80);
    fireEvent.click(container.querySelector("button")!);
    expect(open).toHaveBeenCalledWith(jobs[0]);
    expect(container.querySelector("img")?.getAttribute("srcset")).toContain(
      "1280w",
    );
  });
  it("selects ranges and toggles with the keyboard", () => {
    const select = vi.fn();
    const { container } = render(
      <Gallery
        jobs={jobs.slice(0, 10)}
        mode="grid"
        onOpen={() => {}}
        selectedIds={[]}
        onSelection={select}
      />,
    );
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[0], { ctrlKey: true });
    expect(select).toHaveBeenLastCalledWith(["0"]);
    fireEvent.click(buttons[2], { shiftKey: true });
    expect(select).toHaveBeenLastCalledWith(["0", "1", "2"]);
    fireEvent.keyDown(buttons[0], { key: " " });
    expect(select).toHaveBeenLastCalledWith(["0"]);
    for (const key of [
      "ArrowRight",
      "ArrowLeft",
      "ArrowDown",
      "ArrowUp",
      "Home",
      "End",
      "x",
    ])
      fireEvent.keyDown(buttons[0], { key });
  });
  it("supports masonry and visible result URLs", () => {
    expect(imageUrl(jobs[1], 160)).toContain("thumb=160");
    expect(imageUrl(jobs[1])).not.toContain("thumb");
    render(
      <Gallery
        jobs={jobs.slice(0, 8)}
        mode="masonry"
        onOpen={() => {}}
        selectedIds={["0"]}
        onSelection={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")[0].getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
  it("swaps lightbox image after loading", () => {
    const { container } = render(
      <ImagePreview job={jobs[1]} neighbors={[jobs[2], jobs[3]]} />,
    );
    const full = container.querySelector(".preview-full")!;
    expect(full.className).not.toContain("loaded");
    fireEvent.load(full);
    expect(full.className).toContain("loaded");
  });
});

it("keeps focus mounted, defers images during rapid scrolling and supports mobile widths", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 320 } }]);
      }
      disconnect() {}
    },
  );
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  const { container, rerender } = render(
    <Gallery
      jobs={[
        ...jobs.slice(0, 100),
        { ...jobs[1], id: "api", source: "api", model: "model" },
      ]}
      mode="masonry"
      onOpen={() => {}}
      selectedIds={["0"]}
      onSelection={() => {}}
    />,
  );
  const root = container.querySelector(".virtual-gallery")!;
  Object.defineProperty(root, "getBoundingClientRect", {
    value: () => ({ top: -window.scrollY }),
  });
  const cached = container.querySelector<HTMLImageElement>('[data-index="1"] img')!;
  expect(cached.style.opacity).toBe("0");
  fireEvent.load(cached);
  expect(cached.style.opacity).toBe("1");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 5000 });
  await act(async () => {
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(container.querySelector('[data-index="0"]')).toBeTruthy();
  expect(container.querySelectorAll(".virtual-gallery img")).toHaveLength(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(container.querySelectorAll(".virtual-gallery img").length).toBeGreaterThan(0);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  await act(async () => {
    fireEvent.scroll(window);
    await vi.advanceTimersByTimeAsync(1);
  });
  const returned = container.querySelector<HTMLImageElement>('[data-index="1"] img');
  expect(returned).not.toBeNull();
  expect(returned?.src).toBe(cached.src);
  expect(returned?.style.opacity).toBe("1");
  expect(container.querySelector('[data-index="2"] img')).toBeNull();
  fireEvent.click(container.querySelector('[data-index="0"]')!, {
    metaKey: true,
  });
  fireEvent.keyDown(container.querySelector('[data-index="0"]')!, {
    key: "ArrowRight",
    shiftKey: true,
  });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
  rerender(
    <Gallery
      jobs={[]}
      mode="grid"
      onOpen={() => {}}
      selectedIds={[]}
      onSelection={() => {}}
    />,
  );
  vi.useRealTimers();
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});
it("removes a selected tile with control click", () => {
  const select = vi.fn();
  render(
    <Gallery
      jobs={jobs.slice(0, 2)}
      mode="grid"
      onOpen={() => {}}
      selectedIds={["0"]}
      onSelection={select}
    />,
  );
  fireEvent.click(screen.getAllByRole("button")[0], { ctrlKey: true });
  expect(select).toHaveBeenCalledWith([]);
});
it("deselects an image with the space key", () => {
  const select = vi.fn();
  render(
    <Gallery
      jobs={jobs.slice(0, 2)}
      mode="grid"
      onOpen={() => {}}
      selectedIds={["0"]}
      onSelection={select}
    />,
  );
  fireEvent.keyDown(screen.getAllByRole("button")[0], { key: " " });
  expect(select).toHaveBeenCalledWith([]);
});
it("exports selected image IDs when dragging", () => {
  render(
    <Gallery
      jobs={jobs.slice(0, 2)}
      mode="grid"
      onOpen={() => {}}
      selectedIds={["0", "1"]}
      onSelection={() => {}}
    />,
  );
  const setData = vi.fn();
  fireEvent.dragStart(screen.getAllByRole("button")[0], {
    dataTransfer: { setData, effectAllowed: "" },
  });
  expect(setData).toHaveBeenCalledWith(
    "application/x-image-queue-jobs",
    JSON.stringify(["0", "1"]),
  );
});
it("drags only the grabbed image when it is outside the selection", () => {
  const { container } = render(
    <Gallery jobs={jobs.slice(0, 3)} mode="grid" selectedIds={["0", "1"]} onOpen={vi.fn()} onSelection={vi.fn()} />,
  );
  const transfer = { setData: vi.fn(), effectAllowed: "" };
  const drag = new MouseEvent("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(drag, "dataTransfer", { value: transfer });
  fireEvent(container.querySelector('[data-index="2"]')!, drag);
  expect(transfer.setData).toHaveBeenCalledExactlyOnceWith("application/x-image-queue-jobs", '["2"]');
  expect(transfer.effectAllowed).toBe("copyMove");
});

it("prevents a native drag while Alt is held for area selection", () => {
  const { container } = render(
    <Gallery jobs={jobs.slice(0, 2)} mode="grid" selectedIds={[]} onOpen={vi.fn()} onSelection={vi.fn()} />,
  );
  const transfer = { setData: vi.fn(), effectAllowed: "" };
  const drag = new MouseEvent("dragstart", { altKey: true, bubbles: true, cancelable: true });
  Object.defineProperty(drag, "dataTransfer", { value: transfer });
  expect(fireEvent(container.querySelector('[data-index="0"]')!, drag)).toBe(false);
  expect(transfer.setData).not.toHaveBeenCalled();
});

it("renders accessible annotation pins and regions", () => {
  const select = vi.fn();
  render(
    <ImagePreview
      job={jobs[1]}
      neighbors={[]}
      notes={[
        {
          id: "note",
          imageId: "1",
          text: "Change sky",
          createdAt: "",
          x: 0.2,
          y: 0.3,
          w: 0.2,
          h: 0.1,
        },
      ]}
      onNoteSelect={select}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Note 1: Change sky" }));
  expect(select).toHaveBeenCalledWith("note");
  expect(document.querySelector(".annotation-region")).toBeTruthy();
});
it.each([1, 5])("shows a version badge only for a stack with multiple images (%s)", (count) => {
  render(
    <Gallery
      jobs={[{ ...jobs[1], stackId: "stack" }]}
      stackCounts={{ stack: count }}
      mode="grid"
      onOpen={vi.fn()}
      selectedIds={[]}
      onSelection={vi.fn()}
    />,
  );
  if (count === 1) expect(screen.queryByText(/versions/)).toBeNull();
  else expect(screen.getByText("5 versions")).toBeTruthy();
});
it("selects an image using its checkbox without opening it", () => {
  const select=vi.fn(), open=vi.fn();
  render(<Gallery jobs={jobs.slice(0,1)} mode="grid" onOpen={open} selectedIds={[]} onSelection={select} />);
  fireEvent.click(screen.getByRole("checkbox",{name:"Select Image 0"}));
  expect(select).toHaveBeenCalledWith(["0"]);
  expect(open).not.toHaveBeenCalled();
});
it("supports select-all and clearing through gallery keyboard shortcuts", () => {
  const select=vi.fn();
  render(<Gallery jobs={jobs.slice(0,3)} mode="grid" onOpen={() => {}} selectedIds={[]} onSelection={select} />);
  const gallery=screen.getByRole("region",{name:"Image gallery"});
  fireEvent.keyDown(gallery,{key:"a",ctrlKey:true});
  expect(select).toHaveBeenLastCalledWith(["0","1","2"]);
  fireEvent.keyDown(gallery,{key:"Escape"});
  expect(select).toHaveBeenLastCalledWith([]);
});
it("does not reuse loaded state when switching to another preview", () => {
  const first={...jobs[1],id:"preview-first"};
  const second={...jobs[2],id:"preview-second",status:"done" as const};
  const {container,rerender}=render(<ImagePreview job={first} neighbors={[]} />);
  fireEvent.load(container.querySelector('.preview-full')!);
  expect(container.querySelector('.preview-full')?.classList.contains('loaded')).toBe(true);
  rerender(<ImagePreview job={second} neighbors={[]} />);
  expect(container.querySelector('.preview-full')?.classList.contains('loaded')).toBe(false);
  fireEvent.load(container.querySelector('.preview-full')!);
  expect(container.querySelector('.preview-full')?.classList.contains('loaded')).toBe(true);
});
it("prevents native image dragging from cancelling preview annotation and pan gestures", () => {
  const { container } = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  for (const image of container.querySelectorAll("img")) {
    expect(fireEvent.dragStart(image)).toBe(false);
  }
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  expect(fireEvent.dragStart(container.querySelector(".preview-full")!)).toBe(false);
});

it("toggles native-size preview and resets zoom for a new image", () => {
  const first={...jobs[1],id:"zoom-first",width:1600,height:900};
  const second={...first,id:"zoom-second"};
  const {container,rerender}=render(<ImagePreview job={first} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button",{name:"100%"}));
  expect((container.querySelector(".progressive-image") as HTMLElement).style.width).toBe("1600px");
  expect(screen.getByRole("button",{name:"Fit"})).toBeTruthy();
  rerender(<ImagePreview job={second} neighbors={[]} />);
  expect(screen.getByRole("button",{name:"100%"})).toBeTruthy();
});

it("anchors zoom at the same screen point when the viewport moves during resizing", () => {
  const { container } = render(<ImagePreview job={{ ...jobs[1], width: 1000, height: 1000 }} neighbors={[]} />);
  const viewport = container.querySelector<HTMLElement>(".image-viewport")!;
  const image = container.querySelector<HTMLElement>(".progressive-image")!;
  image.getBoundingClientRect = () => new DOMRect(50, 100, 500, 500);
  viewport.getBoundingClientRect = () => new DOMRect(50, viewport.classList.contains("image-viewport-zoomed") ? 200 : 100, 500, 500);
  Object.defineProperties(image, { offsetWidth: { value: 1000 }, offsetHeight: { value: 1000 } });
  fireEvent.pointerMove(image, { clientX: 300, clientY: 350 });
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  expect(viewport.scrollLeft).toBe(250);
  expect(viewport.scrollTop).toBe(350);
});

it("resets preview scrolling when returning to fit", () => {
  const {container}=render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button",{name:"100%"}));
  const viewport=container.querySelector(".image-viewport") as HTMLElement;
  viewport.scrollLeft=150;
  viewport.scrollTop=200;
  fireEvent.click(screen.getByRole("button",{name:"Fit"}));
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
});

it("pans the native-size image and ends a cancelled gesture", () => {
  const {container}=render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button",{name:"100%"}));
  const viewport=container.querySelector(".image-viewport") as HTMLElement;
  viewport.setPointerCapture=vi.fn();
  fireEvent.pointerDown(viewport,{button:0,pointerId:1,clientX:200,clientY:200});
  fireEvent.pointerMove(viewport,{pointerId:1,clientX:150,clientY:120});
  expect(viewport.scrollLeft).toBe(50);
  expect(viewport.scrollTop).toBe(80);
  fireEvent.pointerCancel(viewport,{pointerId:1});
  fireEvent.pointerMove(viewport,{pointerId:1,clientX:100,clientY:100});
  expect(viewport.scrollLeft).toBe(50);
});

it("allows keyboard panning in the zoomed image region", () => {
  render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button",{name:"100%"}));
  const viewport=screen.getByRole("region",{name:"Zoomed image"});
  fireEvent.keyDown(viewport,{key:"ArrowRight"});
  fireEvent.keyDown(viewport,{key:"ArrowDown",shiftKey:true});
  expect(viewport.scrollLeft).toBe(40);
  expect(viewport.scrollTop).toBe(160);
});

it("focuses the zoomed region for immediate keyboard panning", () => {
  render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button",{name:"100%"}));
  expect(document.activeElement).toBe(screen.getByRole("region",{name:"Zoomed image"}));
});


it("ignores movement from a second pointer while panning", () => {
  const { container } = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const viewport = container.querySelector(".image-viewport") as HTMLElement;
  viewport.setPointerCapture = vi.fn();
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 50, clientY: 50 });
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
});


it("keeps the original pan active when a second pointer starts and ends", () => {
  const { container } = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const viewport = container.querySelector(".image-viewport") as HTMLElement;
  viewport.setPointerCapture = vi.fn();
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(viewport, { pointerId: 2 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 150, clientY: 140 });
  expect(viewport.scrollLeft).toBe(50);
  expect(viewport.scrollTop).toBe(60);
});

it("returns focus to the zoom toggle after fitting the image", () => {
  render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "100%" }));
});


it("reports a full image load failure and clears it after recovery", () => {
  const { container } = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  const fullImage = container.querySelector(".preview-full")!;
  fireEvent.error(fullImage);
  expect(screen.getByRole("status").textContent).toBe("Full image could not be loaded.");
  expect(container.querySelector(".preview-small")).toBeTruthy();
  fireEvent.load(fullImage);
  expect(screen.queryByRole("status")).toBeNull();
});


it("retries failed full images by remounting their image element", () => {
  const { container } = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  const initial = container.querySelector(".preview-full")!;
  fireEvent.error(initial);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(container.querySelector(".preview-full")).not.toBe(initial);
  expect(container.querySelector(".preview-full")?.getAttribute("src")).toContain("retry=1");
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not carry a load error into a different image", () => {
  const view = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.error(view.container.querySelector(".preview-full")!);
  view.rerender(<ImagePreview job={{ ...jobs[1], id: "different-image" }} neighbors={[]} />);
  expect(screen.queryByRole("status")).toBeNull();
});


it("does not pan when arrow keys originate on a preview control", () => {
  const { container } = render(<ImagePreview job={jobs[1]} neighbors={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const viewport = screen.getByRole("region", { name: "Zoomed image" });
  fireEvent.error(container.querySelector(".preview-full")!);
  fireEvent.keyDown(screen.getByRole("button", { name: "Retry loading" }), { key: "ArrowRight" });
  expect(viewport.scrollLeft).toBe(0);
});

it.each(["justified", "masonry", "grid"] as const)("keeps keyboard range selection consistent in %s layout", (mode) => {
  const select = vi.fn();
  const { container } = render(
    <Gallery jobs={jobs.slice(0, 8)} mode={mode} onOpen={vi.fn()} selectedIds={[]} onSelection={select} />,
  );
  const tile = (index: number) => container.querySelector<HTMLButtonElement>(`[data-index="${index}"]`)!;
  fireEvent.keyDown(tile(0), { key: "End", shiftKey: true });
  expect(select).toHaveBeenLastCalledWith(jobs.slice(0, 8).map(job => job.id));
  expect(tile(7).tabIndex).toBe(0);
  expect(tile(0).tabIndex).toBe(-1);
  fireEvent.keyDown(tile(7), { key: "Home", shiftKey: true });
  expect(select).toHaveBeenLastCalledWith(["0"]);
  expect(tile(0).tabIndex).toBe(0);
});

it("summarizes worker size failures on blocked tiles", () => {
  const error = "Size field is missing the PNG suffix required by worker.py publish";
  render(<Gallery
    jobs={[{ ...jobs[0], status: "blocked", error }]}
    mode="grid"
    onOpen={vi.fn()}
    selectedIds={[]}
    onSelection={vi.fn()}
  />);
  expect(screen.getByText("Blocked")).toBeTruthy();
  expect(screen.getByText("Size format rejected by the worker")).toBeTruthy();
  expect(screen.queryByText(error)).toBeNull();
});

it("selects by touch hold, suppresses its click and toggles with the next tap", () => {
  vi.useFakeTimers();
  try {
    const onOpen = vi.fn();
    const onSelection = vi.fn();
    const props = { jobs: jobs.slice(0, 2), mode: "grid" as const, onOpen, onSelection };
    const view = render(<Gallery {...props} selectedIds={[]} />);
    const first = view.container.querySelector('[data-index="0"]')!;
    const second = view.container.querySelector('[data-index="1"]')!;
    fireEvent.pointerDown(first, { pointerType: "touch", clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(450));
    expect(onSelection).toHaveBeenLastCalledWith(["0"]);
    view.rerender(<Gallery {...props} selectedIds={["0"]} />);
    fireEvent.pointerUp(first, { pointerType: "touch" });
    fireEvent.click(first);
    expect(onSelection).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(second, { pointerType: "touch" });
    fireEvent.pointerUp(second, { pointerType: "touch" });
    fireEvent.click(second);
    expect(onSelection).toHaveBeenLastCalledWith(["0", "1"]);
    view.rerender(<Gallery {...props} selectedIds={["0", "1"]} />);
    fireEvent.pointerDown(first, { pointerType: "touch" });
    fireEvent.pointerUp(first, { pointerType: "touch" });
    fireEvent.click(first);
    expect(onSelection).toHaveBeenLastCalledWith(["1"]);
    expect(onOpen).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it.each(["movement", "pointer cancellation"] as const)(
  "does not select an image after %s interrupts a touch hold",
  (interruption) => {
    vi.useFakeTimers();
    try {
      const onSelection = vi.fn();
      const { container } = render(
        <Gallery jobs={jobs.slice(0, 2)} mode="grid" onOpen={vi.fn()} selectedIds={[]} onSelection={onSelection} />,
      );
      const tile = container.querySelector('[data-index="0"]')!;
      fireEvent.pointerDown(tile, { pointerType: "touch", clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(200));
      if (interruption === "movement") {
        fireEvent.pointerMove(tile, { pointerType: "touch", clientX: 10, clientY: 30 });
      } else {
        fireEvent.pointerCancel(tile, { pointerType: "touch" });
      }
      act(() => vi.advanceTimersByTime(450));
      expect(onSelection).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(["pointerUp", "pointerCancel"] as const)(
  "clears the selection rectangle on %s and ignores further movement",
  (endGesture) => {
    const onSelection = vi.fn();
    const { container } = render(
      <Gallery jobs={jobs.slice(0, 2)} mode="grid" onOpen={vi.fn()} selectedIds={["1"]} onSelection={onSelection} />,
    );
    const gallery = screen.getByRole("region", { name: "Image gallery" });
    gallery.setPointerCapture = vi.fn();
    fireEvent.pointerDown(gallery, { pointerId: 4, pointerType: "mouse", button: 0, clientX: 0, clientY: 0, shiftKey: true });
    expect(gallery.setPointerCapture).toHaveBeenCalledWith(4);
    fireEvent.pointerMove(gallery, { pointerId: 4, clientX: 2, clientY: 2 });
    expect(onSelection).not.toHaveBeenCalled();
    fireEvent.pointerMove(gallery, { pointerId: 4, clientX: 30, clientY: 30 });
    expect(container.querySelector(".selection-box")).toBeTruthy();
    expect(onSelection).toHaveBeenCalledWith(expect.arrayContaining(["1"]));
    fireEvent[endGesture](gallery, { pointerId: 4 });
    expect(container.querySelector(".selection-box")).toBeNull();
    fireEvent.pointerMove(gallery, { pointerId: 4, clientX: 80, clientY: 80 });
    expect(onSelection).toHaveBeenCalledTimes(1);
  },
);

it("shows the thumbnail while the original loads and prefetches only ready neighbors", () => {
  const prefetched: string[] = [];
  vi.stubGlobal("Image", class {
    set src(url: string) { prefetched.push(url); }
  });
  const image = jobs[1];
  const readyNeighbor = jobs[2];
  const pendingNeighbor = jobs[3];
  const { container } = render(<ImagePreview job={image} neighbors={[readyNeighbor, pendingNeighbor]} />);
  expect(container.querySelector(".preview-small")?.getAttribute("src")).toBe(imageUrl(image, 640));
  const original = container.querySelector(".preview-full")!;
  expect(original.getAttribute("src")).toBe(imageUrl(image));
  expect(original.classList.contains("loaded")).toBe(false);
  expect(prefetched).toEqual([imageUrl(readyNeighbor)]);
  fireEvent.load(original);
  expect(original.classList.contains("loaded")).toBe(true);
});

it("removes only the unchecked image from a multi-selection", () => {
  const onSelection = vi.fn();
  render(<Gallery jobs={jobs.slice(0, 2)} mode="grid" onOpen={vi.fn()}
    selectedIds={["0", "1"]} onSelection={onSelection} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Image 0" }));
  expect(onSelection).toHaveBeenCalledExactlyOnceWith(["1"]);
});

it.each([["top", -16], ["middle", 0], ["bottom", 16]] as const)(
  "handles area selection scrolling at the %s of the viewport",
  (edge, delta) => {
    vi.useFakeTimers();
    let scrollOffset = 0;
    const scrollBy = vi.fn((_x: number, y: number) => { scrollOffset += y; });
    vi.stubGlobal("scrollBy", scrollBy);
    try {
      const { container } = render(<Gallery jobs={jobs.slice(0, 30)} mode="grid"
        selectedIds={[]} onOpen={vi.fn()} onSelection={vi.fn()} />);
      const gallery = screen.getByRole("region", { name: "Image gallery" });
      gallery.setPointerCapture = vi.fn();
      vi.spyOn(gallery, "getBoundingClientRect").mockImplementation(() =>
        new DOMRect(0, -scrollOffset, 1000, 2000),
      );
      fireEvent.pointerDown(gallery, {
        pointerId: 4, pointerType: "mouse", button: 0, clientX: 0, clientY: 100, shiftKey: true,
      });
      const clientY = edge === "top" ? 2 : edge === "bottom" ? innerHeight - 2 : innerHeight / 2;
      fireEvent.pointerMove(gallery, { pointerId: 4, clientX: 40, clientY });
      const box = container.querySelector<HTMLElement>(".selection-box")!;
      const initialHeight = Number.parseFloat(box.style.height);
      act(() => vi.advanceTimersByTime(32));
      if (delta) expect(scrollBy).toHaveBeenCalledExactlyOnceWith(0, delta);
      else expect(scrollBy).not.toHaveBeenCalled();
      expect(Number.parseFloat(box.style.height)).toBe(initialHeight + Math.abs(delta));
      fireEvent.pointerUp(gallery, { pointerId: 4 });
      act(() => vi.advanceTimersByTime(64));
      expect(scrollBy).toHaveBeenCalledTimes(delta ? 1 : 0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("shows the worker reason on the tile and opens its full detail", () => {
  const error = "Reference file is missing";
  const job = { ...jobs[0], status: "blocked" as const, error };
  const onOpen = vi.fn();
  render(<Gallery jobs={[job]} mode="grid" onOpen={onOpen}
    selectedIds={[]} onSelection={vi.fn()} />);
  expect(screen.getByText(error).classList.contains("pending-reason")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Blocked: Image 0/ }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(job);
});

it("shows archive badges only when the current view requests them", () => {
  const job = { ...jobs[1], archivedAt: "2026-01-01T00:00:00Z" };
  const props = {
    jobs: [job], mode: "grid" as const, selectedIds: [],
    onOpen: vi.fn(), onSelection: vi.fn(),
  };
  const { rerender } = render(<Gallery {...props} showArchiveBadge />);
  expect(screen.getByText("Archived")).toBeTruthy();
  rerender(<Gallery {...props} showArchiveBadge={false} />);
  expect(screen.queryByText("Archived")).toBeNull();
});

it("labels waiting and reserved cards and shows reservation metadata", () => {
  const claim = { owner: "worker-slot-2", since: "2026-11-14T00:00:00Z", reserved: true as const };
  const { container } = render(
    <Gallery jobs={[{ ...jobs[0], claim }, { ...jobs[1], status: "queued" }]} mode="grid" onOpen={() => {}} selectedIds={[]} onSelection={() => {}} />,
  );
  expect(screen.getByRole("button", { name: "Waiting: Image 1" })).toBeTruthy();
  expect(screen.getByText(claim.owner)).toBeTruthy();
  expect(container.querySelector("time")?.dateTime).toBe(claim.since);
  expect(screen.getAllByText("Reserved")).toHaveLength(1);
  const spinner=container.querySelector(".spin");
  expect(spinner).not.toBeNull();
});


it("keeps a gallery tile in place when its thumbnail fails", () => {
  const job = { ...jobs[1], dominantColor: "rgb(50 60 70)" };
  const { container } = render(
    <Gallery jobs={[job]} mode="grid" onOpen={() => {}} selectedIds={[]} onSelection={() => {}} />,
  );
  const image = container.querySelector("img")!;
  fireEvent.error(image);
  expect(image.style.visibility).toBe("hidden");
  expect(screen.getByRole("button", { name: "Ready: Image 1" })).toBeTruthy();
  fireEvent.load(image);
  expect(image.style.visibility).toBe("");
});

it("keeps tiles inside the resized gallery even without a new observer notification",()=>{
  const {container}=render(<Gallery jobs={jobs.slice(0,12)} mode="grid" onOpen={()=>{}} selectedIds={[]} onSelection={()=>{}} />);
  const gallery=screen.getByRole("region",{name:"Image gallery"});
  Object.defineProperty(gallery,"clientWidth",{configurable:true,value:334});
  fireEvent(window,new Event("resize"));
  const cards=[...container.querySelectorAll<HTMLButtonElement>("button[data-index]")];
  expect(cards.length).toBeGreaterThan(0);
  for(const card of cards) expect(parseFloat(card.style.left)+parseFloat(card.style.width)).toBeLessThanOrEqual(334);
});

it("remeasures after a modal updates its body lock following the resize event",async()=>{
  const {container}=render(<Gallery jobs={jobs.slice(0,12)} mode="grid" onOpen={()=>{}} selectedIds={[]} onSelection={()=>{}} />);
  const gallery=screen.getByRole("region",{name:"Image gallery"});
  Object.defineProperty(gallery,"clientWidth",{configurable:true,value:1000});
  vi.useFakeTimers();
  try {
    fireEvent(window,new Event("resize"));
    Object.defineProperty(gallery,"clientWidth",{configurable:true,value:334});
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    for(const card of container.querySelectorAll<HTMLButtonElement>("button[data-index]")) expect(parseFloat(card.style.left)+parseFloat(card.style.width)).toBeLessThanOrEqual(334);
  } finally {vi.useRealTimers();}
});

it("ignores load events belonging to the previously displayed image", () => {
  const first={...jobs[1],id:"late-load-first"};
  const second={...jobs[1],id:"late-load-second"};
  const {container,rerender}=render(<ImagePreview job={first} neighbors={[]} />);
  const old=container.querySelector('.preview-full')!;
  rerender(<ImagePreview job={second} neighbors={[]} />);
  fireEvent.load(old);
  expect(container.querySelector('.preview-full')?.classList.contains('loaded')).toBe(false);
  expect(container.querySelector('.preview-full')?.getAttribute('src')).toContain('late-load-second');
});
it("keeps the same spinner when a reservation starts generating",()=>{
 const reserved={...jobs[0],claim:{owner:"worker",since:"2026-11-16T00:00:00Z",reserved:true as const}};
 const {container,rerender}=render(<Gallery jobs={[reserved]} mode="grid" onOpen={()=>{}} selectedIds={[]} onSelection={()=>{}}/>);
 const spinner=container.querySelector('.spin');
 rerender(<Gallery jobs={[{...reserved,claim:undefined}]} mode="grid" onOpen={()=>{}} selectedIds={[]} onSelection={()=>{}}/>);
 expect(container.querySelector('.spin')).toBe(spinner);
 expect(screen.getByRole('button',{name:/Generating:/})).toBeTruthy();
});
it("retains the waiting pixels until the newly ready thumbnail loads",async()=>{
 const props={mode:"grid" as const,onOpen:()=>{},selectedIds:[],onSelection:()=>{}};
 const waiting={...jobs[0],status:"running" as const};
 const view=render(<Gallery {...props} jobs={[waiting]}/>);
 expect(view.container.querySelector(".pending-art")).toBeTruthy();
 const animate=vi.fn(()=>({cancel:vi.fn(),finished:Promise.resolve()}));
 const original=HTMLElement.prototype.animate;Object.assign(HTMLElement.prototype,{animate});
 try {
  view.rerender(<Gallery {...props} jobs={[{...waiting,status:"done"}]}/>);
  expect(view.container.querySelector(".pending-image-outgoing")?.getAttribute("aria-hidden")).toBe("true");
  await act(async()=>fireEvent.load(view.container.querySelector(".virtual-stage img")!));
  expect(view.container.querySelector(".pending-image-outgoing")).toBeNull();
 } finally {HTMLElement.prototype.animate=original;}
});
it("animates an explicitly inserted card without treating filter changes as insertions", () => {
 const animate=vi.fn(()=>({cancel:vi.fn(),finished:Promise.resolve()}));
 const original=HTMLElement.prototype.animate;
 Object.assign(HTMLElement.prototype,{animate});
 try {
  const props={mode:"grid" as const,onOpen:()=>{},selectedIds:[],onSelection:()=>{}};
  const view=render(<Gallery {...props} jobs={[jobs[1]]} insertionMotionRevision={0}/>);
  animate.mockClear();
  view.rerender(<Gallery {...props} jobs={[jobs[2],jobs[1]]} insertionMotionRevision={1}/>);
  expect(animate).toHaveBeenCalled();
  expect(animate.mock.contexts.some(context => context instanceof HTMLElement && context.dataset.jobId===jobs[2].id)).toBe(true);
  animate.mockClear();
  view.rerender(<Gallery {...props} jobs={[jobs[1]]} insertionMotionRevision={1}/>);
  expect(animate).toHaveBeenCalledOnce();
  expect((animate.mock.contexts[0] as HTMLElement).classList.contains("virtual-gallery")).toBe(true);
 } finally {HTMLElement.prototype.animate=original;}
});
