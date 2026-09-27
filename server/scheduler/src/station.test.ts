import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { Station } from "./station";

let db: Database;
let station: Station;

function addTrack(path: string, artist: string) {
  db.query(
    "INSERT INTO tracks (path, title, artist, duration_s, mtime, size) VALUES (?, ?, ?, 120, 0, 0)",
  ).run(path, path, artist);
}

beforeEach(() => {
  db = openDb(":memory:");
  station = new Station(db, { musicDir: "/music", recentTracks: 500, recentArtists: 0 });
});

describe("Station", () => {
  test("next returns null on an empty library", () => {
    expect(station.next()).toBeNull();
  });

  test("a pick is not a play until it has started", () => {
    addTrack("A/a.opus", "A");
    addTrack("B/b.opus", "B");
    const pick = station.next()!;
    expect(station.nowPlaying()).toBeNull();

    // Liquidsoap reports absolute container paths.
    station.started(`/music/${pick.path}`, 1_000);
    expect(station.nowPlaying()!.track.path).toBe(pick.path);
    expect(station.nowPlaying()!.started_at).toBe(new Date(1_000).toISOString());
  });

  test("pending picks count for anti-repetition", () => {
    for (let i = 0; i < 4; i++) addTrack(`X/t${i}.opus`, `artist${i}`);
    // 4 tracks: window of 2 -> two consecutive picks (not started yet) differ.
    const first = station.next()!;
    const second = station.next()!;
    expect(second.id).not.toBe(first.id);
  });

  test("started ignores unknown files and duplicate reports", () => {
    addTrack("A/a.opus", "A");
    expect(station.started("/music/nope.opus")).toBeNull();
    station.started("A/a.opus", 1_000);
    station.started("/music/A/a.opus", 2_000);
    expect(station.history(10)).toHaveLength(1);
    station.started("A/a.opus", 1_000 + 10 * 60_000);
    expect(station.history(10)).toHaveLength(2);
  });

  test("missing and blacklisted tracks are never picked", () => {
    addTrack("A/a.opus", "A");
    addTrack("B/b.opus", "B");
    addTrack("C/c.opus", "C");
    db.exec("UPDATE tracks SET missing = 1 WHERE path = 'A/a.opus'");
    db.exec("UPDATE tracks SET blacklisted = 1 WHERE path = 'B/b.opus'");
    for (let i = 0; i < 20; i++) expect(station.next()!.path).toBe("C/c.opus");
  });
});
