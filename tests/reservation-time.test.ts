import {expect,it} from 'vitest';
import {reservationTime} from '../src/core/reservation-time';
it('shows local absolute time without seconds and a relative duration',()=>{
 expect(reservationTime('2026-11-16T10:42:59Z',Date.parse('2026-11-16T10:47:59Z'),'en-GB','UTC')).toBe('16 Nov 2026, 10:42 · 5 minutes ago');
});
it('handles missing and future timestamps without invalid dates',()=>{
 expect(reservationTime('invalid')).toBe('an unknown time');
 expect(reservationTime('2026-11-16T10:42:00Z',Date.parse('2026-11-16T10:41:00Z'),'en-GB','UTC')).toBe('16 Nov 2026, 10:42 · just now');
});
