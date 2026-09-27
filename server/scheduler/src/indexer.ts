// Library indexer: mirrors the Opus files and their Vorbis comments into the
// tracks table. Incremental: files whose mtime and size did not change since
// the last scan are not re-parsed.

import type { Database } from "bun:sqlite";
import { parseFile } from "music-metadata";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const PARSE_CONCURRENCY = 16;

export interface ScanResult {
  total: number;
  parsed: number;
  failed: number;
  missing: number;
  durationMs: number;
}

interface FileInfo {
  path: string;
  mtime: number;
  size: number;
}

async function listOpusFiles(root: string): Promise<FileInfo[]> {
  const entries = await readdir(root, { recursive: true });
  const opus = entries.filter((p) => p.toLowerCase().endsWith(".opus")).sort();
  const files: FileInfo[] = [];
  for (const path of opus) {
    const st = await stat(join(root, path));
    if (st.isFile()) files.push({ path, mtime: Math.floor(st.mtimeMs), size: st.size });
  }
  return files;
}

async function readTags(fullPath: string) {
  const meta = await parseFile(fullPath, { duration: true });
  // Vorbis comments, keyed by upper-cased field name (first value wins).
  const tags = new Map<string, string>();
  for (const { id, value } of meta.native.vorbis ?? []) {
    const key = id.toUpperCase();
    if (!tags.has(key) && typeof value === "string") tags.set(key, value);
  }
  const int = (key: string) => {
    const n = Number.parseInt(tags.get(key) ?? "", 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    title: tags.get("TITLE") ?? null,
    album: tags.get("ALBUM") ?? null,
    artist: tags.get("ARTIST") ?? null,
    date: tags.get("DATE") ?? null,
    track_number: int("TRACKNUMBER"),
    track_total: int("TRACKTOTAL"),
    genre: tags.get("GENRE") ?? null,
    hardware: tags.get("HARDWARE") ?? null,
    // ffmpeg writes the COMMENT tag as DESCRIPTION in Ogg files.
    comment: tags.get("COMMENT") ?? tags.get("DESCRIPTION") ?? null,
    duration_s: meta.format.duration ?? null,
  };
}

export async function scanLibrary(db: Database, root: string): Promise<ScanResult> {
  const start = performance.now();
  const files = await listOpusFiles(root);

  const known = new Map<string, { mtime: number; size: number }>();
  for (const row of db.query<{ path: string; mtime: number; size: number }, []>(
    "SELECT path, mtime, size FROM tracks",
  ).all()) {
    known.set(row.path, { mtime: row.mtime, size: row.size });
  }

  const upsert = db.query(`
    INSERT INTO tracks (path, title, album, artist, date, track_number, track_total,
                        genre, hardware, comment, duration_s, mtime, size, missing)
    VALUES ($path, $title, $album, $artist, $date, $track_number, $track_total,
            $genre, $hardware, $comment, $duration_s, $mtime, $size, 0)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title, album = excluded.album, artist = excluded.artist,
      date = excluded.date, track_number = excluded.track_number,
      track_total = excluded.track_total, genre = excluded.genre,
      hardware = excluded.hardware, comment = excluded.comment,
      duration_s = excluded.duration_s, mtime = excluded.mtime,
      size = excluded.size, missing = 0
  `);

  const toParse = files.filter((f) => {
    const k = known.get(f.path);
    return !k || k.mtime !== f.mtime || k.size !== f.size;
  });

  let parsed = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < toParse.length) {
      const file = toParse[next++]!;
      try {
        const tags = await readTags(join(root, file.path));
        upsert.run({ ...tags, path: file.path, mtime: file.mtime, size: file.size });
        parsed++;
      } catch (err) {
        failed++;
        console.error(`indexer: cannot read ${file.path}: ${err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARSE_CONCURRENCY }, worker));

  // Flag files that are gone (and un-flag those that came back), in one go.
  const seen = new Set(files.map((f) => f.path));
  const setMissing = db.query("UPDATE tracks SET missing = $missing WHERE path = $path");
  let missing = 0;
  db.transaction(() => {
    for (const path of known.keys()) {
      const isMissing = seen.has(path) ? 0 : 1;
      missing += isMissing;
      setMissing.run({ missing: isMissing, path });
    }
  })();

  return {
    total: files.length,
    parsed,
    failed,
    missing,
    durationMs: Math.round(performance.now() - start),
  };
}
