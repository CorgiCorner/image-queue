import {afterEach,expect,it,vi} from 'vitest';
import {scheduleQuotaResume} from '../src/core/local-runner-resume';
afterEach(()=>vi.useRealTimers());
it('resumes once at the verified reset time without polling the model',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);const resume=vi.fn().mockResolvedValue(undefined);
 const cancel=scheduleQuotaResume(new Date(6000).toISOString(),resume);
 await vi.advanceTimersByTimeAsync(4999);expect(resume).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(resume).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60000);expect(resume).toHaveBeenCalledTimes(1);cancel();
});
it('cancels a reset when the runner is stopped or paused',async()=>{
 vi.useFakeTimers();const resume=vi.fn().mockResolvedValue(undefined);const cancel=scheduleQuotaResume(new Date(Date.now()+1000).toISOString(),resume);cancel();await vi.advanceTimersByTimeAsync(2000);expect(resume).not.toHaveBeenCalled();
});
it('handles resets beyond the timer range without running immediately',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);const resume=vi.fn().mockResolvedValue(undefined);const cancel=scheduleQuotaResume(new Date(1000+3_000_000_000).toISOString(),resume);
 await vi.advanceTimersByTimeAsync(2_147_483_647);expect(resume).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(852_516_353);expect(resume).toHaveBeenCalledTimes(1);cancel();
});
