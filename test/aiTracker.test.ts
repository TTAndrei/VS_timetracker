import { describe, it, expect } from 'vitest';
import { getModelPrefix, calcCostManual, buildAIDailyData } from '../src/aiTracker';
import { localDay, parseLocalDay, splitByLocalDay } from '../src/storage';

describe('localDay / parseLocalDay', () => {
  it('keys a date by local calendar day, round-trips', () => {
    const d = new Date(2026, 4, 17, 0, 30, 0); // 17 May 2026 00:30 local
    expect(localDay(d)).toBe('2026-05-17');
    const back = parseLocalDay('2026-05-17');
    expect(localDay(back)).toBe('2026-05-17');
  });
});

describe('getModelPrefix', () => {
  it('maps a full Claude model id to its family prefix', () => {
    expect(getModelPrefix('claude-sonnet-4-6')).toBe('claude-sonnet-4');
  });

  it('maps gpt-4o to the gpt-4 prefix', () => {
    expect(getModelPrefix('gpt-4o')).toBe('gpt-4');
  });
});

describe('calcCostManual', () => {
  it('uses sonnet-4 pricing (3 in / 15 out per Mtok)', () => {
    expect(calcCostManual(1_000_000, 1_000_000, 'claude-sonnet-4', [])).toBeCloseTo(18, 5);
  });
});

describe('splitByLocalDay', () => {
  it('splits a session crossing local midnight, preserving total duration', () => {
    const start = new Date(2026, 4, 16, 23, 30, 0); // 16 May 23:30 local
    const end = new Date(2026, 4, 17, 1, 15, 0);    // 17 May 01:15 local
    const parts = splitByLocalDay(start, end);
    expect(parts.length).toBe(2);
    expect(localDay(parts[0].start)).toBe('2026-05-16');
    expect(localDay(parts[1].start)).toBe('2026-05-17');
    const total = parts.reduce((a, p) => a + p.duration_ms, 0);
    expect(total).toBe(end.getTime() - start.getTime());
  });

  it('returns a single part when within one day', () => {
    const start = new Date(2026, 4, 17, 9, 0, 0);
    const end = new Date(2026, 4, 17, 10, 30, 0);
    const parts = splitByLocalDay(start, end);
    expect(parts.length).toBe(1);
    expect(parts[0].duration_ms).toBe(90 * 60 * 1000);
  });
});

describe('buildAIDailyData', () => {
  it('returns empty array for no sessions', () => {
    expect(buildAIDailyData([])).toEqual([]);
  });
});
