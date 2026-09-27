import { describe, expect, test } from "bun:test";
import { type Candidate, pickTrack } from "./picker";

function track(id: number, artist: string | null, extra: Partial<Candidate> = {}): Candidate {
  return { id, artist, weight: 1, blacklisted: false, ...extra };
}

// Deterministic PRNG (mulberry32) so statistical tests are reproducible.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const opts = { recentTracks: 500, recentArtists: 3 };

describe("pickTrack", () => {
  test("returns null on an empty or fully blacklisted library", () => {
    expect(pickTrack([], [], opts)).toBeNull();
    expect(pickTrack([track(1, "A", { blacklisted: true })], [], opts)).toBeNull();
    expect(pickTrack([track(1, "A", { weight: 0 })], [], opts)).toBeNull();
  });

  test("never picks blacklisted tracks", () => {
    const lib = [track(1, "A", { blacklisted: true }), track(2, "B"), track(3, "C", { blacklisted: true })];
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      expect(pickTrack(lib, [], { ...opts, random })!.id).toBe(2);
    }
  });

  test("excludes recently played tracks and composers", () => {
    const lib = [track(1, "A"), track(2, "A"), track(3, "B"), track(4, "C"), track(5, "D")];
    const recent = [
      { trackId: 3, artist: "B" },
      { trackId: 1, artist: "A" },
    ];
    const random = seeded(2);
    for (let i = 0; i < 200; i++) {
      // 1 and 3 were played; A and B are recent composers, so 2 is out too.
      expect([4, 5]).toContain(pickTrack(lib, recent, { ...opts, random })!.id);
    }
  });

  test("only the last K plays count for the composer rule", () => {
    const lib = [track(1, "A"), track(2, "B"), track(3, "C"), track(4, "D"), track(5, "D")];
    const recent = [
      { trackId: 1, artist: "A" },
      { trackId: 4, artist: "D" },
    ];
    const random = seeded(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seen.add(pickTrack(lib, recent, { recentTracks: 500, recentArtists: 1, random })!.id);
    }
    // Composer D is outside the 1-play window, so track 5 is allowed.
    expect([...seen].sort()).toEqual([2, 3, 5]);
  });

  test("relaxes the composer rule when a single composer is left", () => {
    const lib = [track(1, "A"), track(2, "A"), track(3, "A"), track(4, "A")];
    const pick = pickTrack(lib, [{ trackId: 1, artist: "A" }], { ...opts, random: seeded(4) });
    expect(pick).not.toBeNull();
    expect(pick!.id).not.toBe(1);
  });

  test("never excludes more than half the library", () => {
    const lib = Array.from({ length: 10 }, (_, i) => track(i, `artist${i}`));
    // All 10 tracks were played, most recent first: 9, 8, ..., 0.
    const recent = lib.map((t) => ({ trackId: t.id, artist: t.artist })).reverse();
    const random = seeded(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seen.add(pickTrack(lib, recent, { recentTracks: 500, recentArtists: 0, random })!.id);
    }
    // The 5 most recent (9..5) are excluded, the 5 oldest are available.
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  test("does not replay the same track back to back in a tiny library", () => {
    const lib = [track(1, "A"), track(2, "A")];
    const random = seeded(6);
    for (let i = 0; i < 100; i++) {
      expect(pickTrack(lib, [{ trackId: 1, artist: "A" }], { ...opts, random })!.id).toBe(2);
    }
  });

  test("honors weights", () => {
    const lib = [track(1, "A", { weight: 3 }), track(2, "B", { weight: 1 })];
    const random = seeded(7);
    let heavy = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      if (pickTrack(lib, [], { ...opts, random })!.id === 1) heavy++;
    }
    expect(heavy / n).toBeGreaterThan(0.72);
    expect(heavy / n).toBeLessThan(0.78);
  });
});
