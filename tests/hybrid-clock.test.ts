import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { nextHybridClock, compareVersions, tickHybridClock } from "../src/core/hybrid-clock";
import { MemoryStorage } from "../src/storage/memory";
import { FileStorage } from "../src/storage/fs";
import { StorageLockBusy } from "../src/storage/types";

afterEach(() => vi.useRealTimers());
it.each([
  [100, undefined, undefined, {wallTime:100,logical:0}],
  [100, {wallTime:100,logical:2}, undefined, {wallTime:100,logical:3}],
  [90, {wallTime:100,logical:2}, {wallTime:100,logical:8}, {wallTime:100,logical:9}],
  [90, {wallTime:100,logical:2}, {wallTime:120,logical:8}, {wallTime:120,logical:9}],
  [130, {wallTime:100,logical:2}, {wallTime:120,logical:8}, {wallTime:130,logical:0}],
] as const)("advances HLC for wall time %s", (now, previous, remote, expected) => {
  expect(nextHybridClock(now,previous,remote)).toEqual(expected);
});
it("orders a causally later edit from a machine five minutes behind",async()=>{
  const a=new MemoryStorage(),b=new MemoryStorage();
  const first=await tickHybridClock(a,"machine-a",undefined,600_000);
  const next=await tickHybridClock(b,"machine-b",first.clock,300_000);
  expect(compareVersions(next,first)).toBe(1);
  const final=await tickHybridClock(a,"machine-a",next.clock,600_000);
  expect(compareVersions(final,next)).toBe(1);
});
it("uses a deterministic machine-ID tie breaker",()=>{
  const clock={wallTime:100,logical:0};
  const a={clock,changedBy:"A"},b={clock,changedBy:"a"};
  expect(compareVersions(a,b)).toBe(-1);
  expect(compareVersions(b,a)).toBe(1);
  expect(compareVersions(a,a)).toBe(0);
  expect(compareVersions({...a,clock:{wallTime:101,logical:0}},b)).toBe(1);
  expect(compareVersions({...a,clock:{wallTime:100,logical:1}},b)).toBe(1);
});
it("persists the clock across a disk-store restart and clock rollback",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"iq-clock-"));
  try {
    const first=await tickHybridClock(new FileStorage(root),"machine",undefined,600_000);
    const next=await tickHybridClock(new FileStorage(root),"machine",undefined,1);
    expect(compareVersions(next,first)).toBe(1);
    expect(await new FileStorage(root).get("settings","sync-clock")).toEqual(next.clock);
  } finally {await rm(root,{recursive:true,force:true});}
});
it("gives simultaneous local events distinct, increasing versions",async()=>{
  const store=new MemoryStorage();
  const versions=await Promise.all(Array.from({length:10},()=>tickHybridClock(store,"machine",undefined,100)));
  expect(new Set(versions.map(v=>JSON.stringify(v.clock))).size).toBe(10);
  expect(await store.get("settings","sync-clock")).toEqual({wallTime:100,logical:9});
});
it("rolls over a logical counter without losing ordering and refuses total exhaustion",()=>{
  expect(nextHybridClock(1,{wallTime:100,logical:Number.MAX_SAFE_INTEGER})).toEqual({wallTime:101,logical:0});
  expect(()=>nextHybridClock(1,{wallTime:Number.MAX_SAFE_INTEGER,logical:Number.MAX_SAFE_INTEGER})).toThrow("exhausted");
});
it("rejects invalid clocks and does not silently reset corrupt persisted state",async()=>{
  for(const now of [-1,NaN,Infinity,0.5])expect(()=>nextHybridClock(now)).toThrow();
  expect(()=>nextHybridClock(100,{wallTime:100,logical:-1})).toThrow();
  const store=new MemoryStorage();await store.put("settings","sync-clock",{wallTime:-1,logical:0});
  await expect(tickHybridClock(store,"machine")).rejects.toThrow();
  expect(await store.get("settings","sync-clock")).toEqual({wallTime:-1,logical:0});
  await expect(tickHybridClock(store,"../machine")).rejects.toThrow();
});
it("bounds contention retries and does not retry unrelated storage failures",async()=>{
  vi.useFakeTimers();
  const store=new MemoryStorage();
  const locked=vi.spyOn(store,"lock").mockRejectedValue(new StorageLockBusy("sync-clock"));
  const pending=expect(tickHybridClock(store,"machine")).rejects.toThrow("operation");
  await vi.runAllTimersAsync();await pending;
  expect(locked).toHaveBeenCalledTimes(20);
  locked.mockClear().mockRejectedValue(new StorageLockBusy("different-key"));
  await expect(tickHybridClock(store,"machine")).rejects.toThrow();
  expect(locked).toHaveBeenCalledTimes(1);
});

it("orders earlier physical and logical versions before later versions",()=>{
  expect(compareVersions({clock:{wallTime:1,logical:9},changedBy:"z"},{clock:{wallTime:2,logical:0},changedBy:"a"})).toBe(-1);
  expect(compareVersions({clock:{wallTime:2,logical:1},changedBy:"z"},{clock:{wallTime:2,logical:2},changedBy:"a"})).toBe(-1);
});
it("does not retry a failed clock write or accept invalid observed data",async()=>{
  const store=new MemoryStorage();
  const put=vi.spyOn(store,"put").mockRejectedValue(new Error("Disk full"));
  await expect(tickHybridClock(store,"machine",undefined,100)).rejects.toThrow("Disk full");
  expect(put).toHaveBeenCalledTimes(1);
  put.mockRestore();
  await expect(tickHybridClock(store,"machine",{wallTime:1,logical:-1})).rejects.toThrow();
  expect(await store.get("settings","sync-clock")).toBeUndefined();
});
