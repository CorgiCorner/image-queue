import {UserFacingError} from './user-facing-error';
/** Scheduling is local code; the generation model never manages this pool. */
export interface LocalWork { id: string }
export interface LocalWorkerPorts<T extends LocalWork> {
  claim(allowed:()=>boolean): Promise<T | undefined>;
  /** Must commit the attempt before any generation process starts. */
  begin(job: T): Promise<void>;
  execute(job: T, signal: AbortSignal): Promise<void>;
  complete(job: T): Promise<void>;
  uncertain(job: T, error: unknown): Promise<void>;
  report(error: unknown): void;
  blocked?(message:string,phase:'admission'|'generation',jobId?:string):Promise<void>;
}

export class LocalWorkerPool<T extends LocalWork> {
  private limit = 0;
  private scanning = false;
  private requested = false;
  private closed = false;
  private failure: string | undefined;
  private active = new Map<string, AbortController>();
  constructor(private readonly ports: LocalWorkerPorts<T>) {}
  get running() { return this.active.size; }
  get settling() { return this.scanning || this.active.size > 0; }
  get enabled() { return this.limit; }
  get blockedReason() { return this.failure; }
  block(message:string) { this.failure=message; }
  configure(count: number) {
    if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error('Invalid local worker count');
    this.limit = count;
    this.failure = undefined;
    this.wake();
  }
  /** Called on enqueue and on completion; no model invocation while idle. */
  wake() {
    if (this.closed || this.failure) return;
    this.requested = true;
    if (!this.scanning) void this.scan();
  }
  private async scan() {
    this.scanning = true;
    try {
      while (this.requested && !this.closed) {
        this.requested = false;
        while (!this.closed && !this.failure && this.active.size < this.limit) {
          const job = await this.ports.claim(()=>!this.closed&&!this.failure&&this.active.size<this.limit);
          if (!job) break;
          // A claimed job is never discarded when pause happens during claim.
          if (this.active.has(job.id)) throw new Error('Duplicate local worker claim');
          const controller = new AbortController();
          this.active.set(job.id, controller);
          void this.run(job, controller);
        }
      }
    } catch (error) { this.failure = error instanceof UserFacingError ? error.message : "Local execution needs attention. Resolve the error before resuming."; try { await this.ports.blocked?.(this.failure,'admission'); } catch(saveError) { this.ports.report(saveError); } this.ports.report(error); }
    finally { this.scanning = false; }
  }
  private async run(job: T, controller: AbortController) {
    let begun = false;
    try {
      await this.ports.begin(job);
      begun = true;
      if (controller.signal.aborted) throw new Error('Generation stopped before process start');
      await this.ports.execute(job, controller.signal);
      if (controller.signal.aborted) throw new Error('Generation cancelled before publication');
      await this.ports.complete(job);
    } catch (error) {
      // Stop draining the backlog after a failed attempt, including quota/auth failures.
      this.failure = error instanceof UserFacingError ? error.message : "Local execution paused after an unsuccessful attempt. Check the result before resuming.";
      try { await this.ports.blocked?.(this.failure,'generation',job.id); } catch(saveError) { this.ports.report(saveError); }
      // Never replay an ambiguous generation automatically.
      try { await this.ports.uncertain(job, error); }
      catch (saveError) { this.ports.report(saveError); }
      if (!begun) this.ports.report(error);
    } finally {
      this.active.delete(job.id);
      this.wake();
    }
  }
  /** Graceful shutdown drains; explicit cancellation is uncertain, never retry. */
  stop(cancelRunning = false) {
    this.closed = true;
    this.limit = 0;
    if (cancelRunning) for (const controller of this.active.values()) controller.abort();
  }
}
