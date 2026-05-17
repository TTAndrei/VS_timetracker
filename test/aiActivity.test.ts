import { describe, it, expect } from 'vitest';

// Reproduces the idle-gap credit rule used by AIActivityTracker.poll():
// a gap within gapMs is counted in full; a longer gap counts only one poll.
function credit(deltaMs: number, gapMs: number, pollMs: number): number {
  return deltaMs <= gapMs ? deltaMs : pollMs;
}

describe('AI activity idle-gap credit', () => {
  it('counts a short gap in full', () => {
    expect(credit(120_000, 300_000, 30_000)).toBe(120_000);
  });

  it('caps a long gap to a single poll interval', () => {
    expect(credit(900_000, 300_000, 30_000)).toBe(30_000);
  });

  it('counts an exactly-at-threshold gap in full', () => {
    expect(credit(300_000, 300_000, 30_000)).toBe(300_000);
  });
});
