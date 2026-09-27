// Station state: glues the database and the picker together.
//
// Liquidsoap asks for the next track ahead of time (prefetch), so "picked"
// and "playing" are distinct: a pick is only recorded as a play once
// Liquidsoap reports that it actually started. Picks not started yet are kept
// in memory so they count for anti-repetition too.

import type { Database } from "bun:sqlite";
import type { Track } from "./db";
import { type Candidate, pickTrack, type RecentEntry } from "./picker";

// Maximum number of picks waiting to be played. Liquidsoap normally has at
// most one or two queued; older ones are dropped (e.g. Liquidsoap restarted).
const MAX_PENDING = 5;
// The same track reported twice within this delay is a single play.
const DUPLICATE_START_MS = 30_000;

export interface StationOptions {
  musicDir: string;
  recentTracks: number;
  recentArtists: number;
}

export interface PublicTrack {
  id: number;
  path: string;
  title: string | null;
  album: string | null;
  artist: string | null;
  date: string | null;
  track_number: number | null;
  track_total: number | null;
  genre: string | null;
  hardware: string | null;
  comment: string | null;
  duration_s: number | null;
}

export interface PlayInfo {
  started_at: string;
  track: PublicTrack;
}

export function toPublic(t: Track): PublicTrack {
  return {
    id: t.id,
    path: t.path,
    title: t.title,
    album: t.album,
    artist: t.artist,
    date: t.date,
    track_number: t.track_number,
    track_total: t.track_total,
    genre: t.genre,
    hardware: t.hardware,
    comment: t.comment,
    duration_s: t.duration_s,
  };
}

type PlayRow = Track & { started_at: number };

export class Station {
  private pending: RecentEntry[] = [];

  constructor(
    private readonly db: Database,
    private readonly opts: StationOptions,
  ) {}

  /** Chooses the next track to hand to Liquidsoap. */
  next(): Track | null {
    const rows = this.db
      .query<{ id: number; artist: string | null; weight: number; blacklisted: number }, []>(
        "SELECT id, artist, weight, blacklisted FROM tracks WHERE missing = 0",
      )
      .all();
    const candidates: Candidate[] = rows.map((r) => ({ ...r, blacklisted: r.blacklisted !== 0 }));

    const played = this.db
      .query<RecentEntry, [number]>(
        `SELECT p.track_id AS trackId, t.artist AS artist
         FROM plays p JOIN tracks t ON t.id = p.track_id
         ORDER BY p.started_at DESC, p.id DESC LIMIT ?`,
      )
      .all(this.opts.recentTracks);

    const pick = pickTrack(candidates, [...this.pending, ...played], this.opts);
    if (!pick) return null;
    this.pending = [{ trackId: pick.id, artist: pick.artist }, ...this.pending].slice(0, MAX_PENDING);
    return this.getTrack(pick.id);
  }

  /**
   * Records that a track started playing. `path` is what Liquidsoap knows:
   * absolute inside the container, or relative to the music root.
   * Returns null if the file is not in the index.
   */
  started(path: string, now = Date.now()): Track | null {
    const prefix = `${this.opts.musicDir}/`;
    const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\/+/, "");
    const track = this.db.query<Track, [string]>("SELECT * FROM tracks WHERE path = ?").get(rel);
    if (!track) return null;

    this.pending = this.pending.filter((e) => e.trackId !== track.id);
    const last = this.lastPlay();
    if (last && last.id === track.id && now - last.started_at < DUPLICATE_START_MS) return track;

    this.db.query("INSERT INTO plays (track_id, started_at) VALUES (?, ?)").run(track.id, now);
    return track;
  }

  nowPlaying(): PlayInfo | null {
    const last = this.lastPlay();
    return last ? toPlayInfo(last) : null;
  }

  history(limit: number): PlayInfo[] {
    return this.db
      .query<PlayRow, [number]>(
        `SELECT t.*, p.started_at FROM plays p JOIN tracks t ON t.id = p.track_id
         ORDER BY p.started_at DESC, p.id DESC LIMIT ?`,
      )
      .all(limit)
      .map(toPlayInfo);
  }

  stats(): { tracks: number; missing: number; blacklisted: number; plays: number } {
    return this.db
      .query<{ tracks: number; missing: number; blacklisted: number; plays: number }, []>(
        `SELECT
           (SELECT COUNT(*) FROM tracks WHERE missing = 0) AS tracks,
           (SELECT COUNT(*) FROM tracks WHERE missing = 1) AS missing,
           (SELECT COUNT(*) FROM tracks WHERE blacklisted = 1) AS blacklisted,
           (SELECT COUNT(*) FROM plays) AS plays`,
      )
      .get()!;
  }

  private getTrack(id: number): Track | null {
    return this.db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id);
  }

  private lastPlay(): PlayRow | null {
    return this.db
      .query<PlayRow, []>(
        `SELECT t.*, p.started_at FROM plays p JOIN tracks t ON t.id = p.track_id
         ORDER BY p.started_at DESC, p.id DESC LIMIT 1`,
      )
      .get();
  }
}

function toPlayInfo(row: PlayRow): PlayInfo {
  return { started_at: new Date(row.started_at).toISOString(), track: toPublic(row) };
}
