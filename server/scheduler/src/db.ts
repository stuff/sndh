// SQLite storage: the track index and the play history.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Track {
  id: number;
  // Relative to the music root, e.g. "4-Mat/Captain_Dynamo_01.opus".
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
  mtime: number;
  size: number;
  // Picking weight; 1 by default, meant to be driven by votes later.
  weight: number;
  blacklisted: number;
  // The file disappeared from the library at the last scan.
  missing: number;
}

export interface Play {
  id: number;
  track_id: number;
  // Unix epoch, milliseconds.
  started_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  title        TEXT,
  album        TEXT,
  artist       TEXT,
  date         TEXT,
  track_number INTEGER,
  track_total  INTEGER,
  genre        TEXT,
  hardware     TEXT,
  comment      TEXT,
  duration_s   REAL,
  mtime        INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  weight       REAL NOT NULL DEFAULT 1,
  blacklisted  INTEGER NOT NULL DEFAULT 0,
  missing      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plays (
  id         INTEGER PRIMARY KEY,
  track_id   INTEGER NOT NULL REFERENCES tracks(id),
  started_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_started_at ON plays(started_at);
`;

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
