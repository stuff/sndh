#!/usr/bin/env python3
"""Batch conversion of SNDH files (Atari ST, YM2149) -> Opus (Ogg) for streaming.

Pipeline per sub-tune:
    sc68 (or psgplay): 48 kHz WAV render; tags and durations are always read via psgplay
      -> ffmpeg pass 1: highpass 5 Hz (DC offset) + EBU R128 measurement (ebur128)
      -> ffmpeg pass 2: highpass + linear gain + [fade] + libopus + tags

The normalization is equivalent to loudnorm's linear mode (single gain toward the
target, capped by the peak) but avoids its 192 kHz upsampling, which is ten times slower.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from fnmatch import fnmatch
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

SAMPLE_RATE = 48000          # Opus's native rate: no resampling needed at encode time
HIGHPASS_HZ = 5              # YM2149 rendering has a strong DC offset
SILENCE_LUFS = -70.0         # below this, the track is considered silent

log = logging.getLogger("sndh2opus")

# Letters from the SNDH FLAG tag (see psgplay's include/psgplay/sndh.h), 'y' = YM2149.
SNDH_FLAGS = {
    "y": "YM2149", "e": "STE DMA", "l": "LMC1992", "0": "STE DMA", "1": "STE DMA",
    "2": "STE DMA", "3": "STE DMA", "4": "Falcon DMA", "5": "Falcon DMA", "6": "Falcon DMA",
    "7": "Falcon DMA", "8": "Falcon DMA", "9": "Falcon DMA", "A": "Falcon DMA",
    "s": "DSP 56001", "C": "68020", "B": "Blitter", "t": "Blitter", "h": "HBL",
    "a": "MFP timer A", "b": "MFP timer B", "c": "MFP timer C", "d": "MFP timer D",
}
FALCON_FLAGS = set("456789AsC")
STE_FLAGS = set("e0123l")


def describe_hardware(flags: str) -> str:
    """'abdy' -> 'Atari ST: YM2149, MFP timer A, MFP timer B, MFP timer D'."""
    machine = ("Atari Falcon" if FALCON_FLAGS & set(flags)
               else "Atari STE" if STE_FLAGS & set(flags) else "Atari ST")
    parts = sorted({SNDH_FLAGS[f] for f in flags if f in SNDH_FLAGS},
                   key=lambda p: (p != "YM2149", p))
    return f"{machine}: {', '.join(parts)}" if parts else machine


# --------------------------------------------------------------------------- #
# Reading SNDH tags
# --------------------------------------------------------------------------- #

@dataclass
class SndhInfo:
    tags: dict[str, str] = field(default_factory=dict)
    subtunes: int = 1
    durations: dict[int, float] = field(default_factory=dict)   # sub-tune -> seconds
    names: dict[int, str] = field(default_factory=dict)         # sub-tune -> name (!#SN)
    flags: dict[int, str] = field(default_factory=dict)         # sub-tune -> FLAG letters
    global_flags: str = ""                                      # FLAG~: applies to all sub-tunes

    def hardware(self, subtune: int) -> str:
        flags = self.flags.get(subtune, self.global_flags)
        return describe_hardware(flags) if flags else ""

    def duration(self, subtune: int) -> float | None:
        d = self.durations.get(subtune)
        return d if d and d > 0 else None   # 0 = infinite loop in the SNDH spec


def decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def parse_info(text: str) -> SndhInfo:
    """Parses the output of `psgplay --info`."""
    info = SndhInfo()
    frms: dict[int, float] = {}
    times: dict[int, float] = {}
    last_key: str | None = None

    for line in text.splitlines():
        if line.startswith("\t") and last_key:        # continuation of a multi-line value
            info.tags[last_key] += "\n" + line[1:]
            continue
        last_key = None
        if not line.startswith("tag field "):
            continue
        name, _, rest = line[len("tag field "):].partition(" ")
        parts = rest.split()
        try:
            if name == "FRMS":
                # "FRMS <n> <frames> <seconds> <mm:ss>" or "FRMS <n> <frames> - -"
                if len(parts) >= 3 and parts[2] != "-":
                    frms[int(parts[0])] = float(parts[2])
            elif name == "TIME":
                times[int(parts[0])] = float(parts[1])
            elif name == "!#SN":
                idx, _, sn = rest.partition(" ")
                if sn.strip().lower() not in ("", "n/a", "-", "?"):   # placeholder values
                    info.names[int(idx)] = sn.strip()
            elif name == "##":
                info.subtunes = max(1, int(parts[0]))
            elif name == "FLAG":
                # "FLAG ~ <letters> <names…>" (global) or "FLAG <n> <letters> <names…>"
                if parts[0] == "~":
                    info.global_flags = parts[1]
                else:
                    info.flags[int(parts[0])] = parts[1]
            else:
                info.tags[name] = rest.strip()
                last_key = name
        except (ValueError, IndexError):
            log.debug("unreadable tag ignored: %r", line)

    # FRMS is more precise than TIME (whole seconds); fall back to TIME otherwise.
    for n in range(1, info.subtunes + 1):
        d = frms.get(n) or times.get(n)
        if d:
            info.durations[n] = d
    return info


def read_info(cfg: argparse.Namespace, path: Path) -> SndhInfo:
    res = subprocess.run([cfg.psgplay, "--info", str(path)],
                         capture_output=True, timeout=60)
    err = decode(res.stderr).strip()
    # psgplay returns 0 even on an invalid header: check stderr and "header size" too.
    if res.returncode != 0 or "invalid SNDH" in err or "\nheader size 0\n" in decode(res.stdout):
        raise RuntimeError(f"invalid or unreadable SNDH file: {err or 'empty header'}")
    return parse_info(decode(res.stdout))


# --------------------------------------------------------------------------- #
# Converting a sub-tune
# --------------------------------------------------------------------------- #

@dataclass
class Task:
    src: Path
    rel: Path
    dst: Path
    subtune: int
    info: SndhInfo
    renderer: str

    @property
    def label(self) -> str:
        return f"{self.rel} #{self.subtune}"


class TaskError(RuntimeError):
    pass


def run(cmd: list[str], timeout: float, what: str, stdin=None) -> subprocess.CompletedProcess:
    try:
        res = subprocess.run(cmd, stdin=stdin, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise TaskError(f"{what}: timed out ({timeout:.0f}s)")
    if res.returncode != 0:
        tail = "\n".join(decode(res.stderr).strip().splitlines()[-8:])
        raise TaskError(f"{what}: exit code {res.returncode}\n{tail}")
    return res


def render_psgplay(cfg, task: Task, duration: float, wav: Path, timeout: float) -> None:
    cmd = [cfg.psgplay, "--quiet", f"--track={task.subtune}",
           f"--length={duration:.3f}", f"--frequency={SAMPLE_RATE}"]
    if cfg.stereo:
        cmd.append(f"--psg-balance={cfg.balance}")
    cmd += ["-o", str(wav), str(task.src)]
    run(cmd, timeout, "psgplay")


def render_sc68(cfg, task: Task, duration: float, wav: Path, timeout: float) -> None:
    # sc68 ignores FRMS and can't write WAV to a pipe: we make it loop
    # indefinitely as raw PCM on stdout and let ffmpeg cut it to the right duration.
    with open(wav.with_suffix(".err"), "w+b") as err:
        sc = subprocess.Popen([cfg.sc68, "-q", f"--ym-engine={cfg.ym_engine}",
                               f"--track={task.subtune}", "--loop=inf",
                               f"--rate={SAMPLE_RATE}", "--stdout", str(task.src)],
                              stdout=subprocess.PIPE, stderr=err)
        try:
            run([cfg.ffmpeg, "-hide_banner", "-nostats", "-loglevel", "error", "-y",
                 "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "-",
                 "-t", f"{duration:.3f}", str(wav)], timeout, "sc68 | ffmpeg", stdin=sc.stdout)
        finally:
            sc.stdout.close()   # SIGPIPE: stops the infinite loop
            sc.kill()
            rc = sc.wait()
        if rc not in (0, -9, -13):   # -9/-13: killed by us or by SIGPIPE
            err.seek(0)
            tail = "\n".join(decode(err.read()).strip().splitlines()[-4:])
            raise TaskError(f"sc68: exit code {rc}\n{tail}")


RENDERERS = {"psgplay": render_psgplay, "sc68": render_sc68}


def render(cfg, task: Task, duration: float, wav: Path, timeout: float) -> tuple[str, float, str]:
    """Renders with the chosen engine, then with the other one on failure.
    Returns (engine used, rendered duration, first engine's error or "")."""
    first_error = ""
    for renderer in (task.renderer, *(r for r in RENDERERS if r != task.renderer)):
        try:
            RENDERERS[renderer](cfg, task, duration, wav, timeout)
            with wave.open(str(wav)) as w:
                rendered = w.getnframes() / w.getframerate()
            if rendered <= 0:
                raise TaskError(f"{renderer} produced no samples")
            return renderer, rendered, first_error
        except (TaskError, OSError, EOFError, wave.Error) as e:
            if first_error:
                raise TaskError(f"{first_error}\nthen {e}")
            first_error = f"{renderer}: {e}" if not str(e).startswith(renderer) else str(e)
    raise AssertionError("unreachable")


def base_filters(cfg) -> str:
    # Explicit downmix at the head of the filter chain: the one ffmpeg inserts on its
    # own doesn't have the same gain depending on the negotiated sample format (+3 dB
    # in float), which would skew the gap between measurement and encoding. Both
    # engines output stereo.
    layout = "aformat=channel_layouts=stereo" if cfg.stereo else "pan=mono|c0=0.5*c0+0.5*c1"
    return f"{layout},highpass=f={HIGHPASS_HZ}"


def measure_loudness(cfg, wav: Path, timeout: float) -> tuple[float, float] | None:
    """Returns (integrated loudness in LUFS, sample peak in dBFS), or None if silent."""
    af = f"{base_filters(cfg)},ebur128=peak=sample:framelog=verbose"
    res = run([cfg.ffmpeg, "-hide_banner", "-nostats", "-i", str(wav),
               "-af", af, "-f", "null", "-"], timeout, "ffmpeg (ebur128 measurement)")
    summary = decode(res.stderr).rpartition("Summary:")[2]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)
    if not i or not peak or float(i[1]) <= SILENCE_LUFS:   # silent or "-inf"
        return None
    return float(i[1]), float(peak[1])


def build_metadata(task: Task, renderer: str) -> dict[str, str]:
    info, n, total = task.info, task.subtune, task.info.subtunes
    base = info.tags.get("TITL") or task.src.stem
    if total > 1:
        title = f"{base} - {info.names[n]}" if info.names.get(n) else f"{base} ({n}/{total})"
    else:
        title = info.names.get(n) or base
    meta = {
        "TITLE": title,
        "ALBUM": base,
        "ARTIST": info.tags.get("COMM", ""),
        "DATE": info.tags.get("YEAR", ""),
        "TRACKNUMBER": str(n),
        "TRACKTOTAL": str(total),
        "GENRE": "Chiptune",
        "HARDWARE": info.hardware(n),
        "COMMENT": f"SNDH: {task.rel.as_posix()}"
                   + (f" | ripped by {info.tags['RIPP']}" if info.tags.get("RIPP") else "")
                   + f" | rendered with {renderer}",
    }
    return {k: v for k, v in meta.items() if v}


def convert(cfg: argparse.Namespace, task: Task) -> str:
    duration = task.info.duration(task.subtune)
    fallback = duration is None
    if fallback:
        duration = cfg.fallback
    # Emulation runs at 25 to 200x real time: plenty of margin.
    timeout = 120 + duration

    task.dst.parent.mkdir(parents=True, exist_ok=True)
    part = task.dst.with_name(task.dst.name + ".part")

    with tempfile.TemporaryDirectory(prefix="sndh2opus-") as tmp:
        wav = Path(tmp) / "render.wav"
        renderer, rendered, render_error = render(cfg, task, duration, wav, timeout)
        if render_error:
            log.warning("%s: rendered with %s after failure of %s", task.label, renderer, render_error)

        filters = [base_filters(cfg)]
        m = measure_loudness(cfg, wav, timeout)
        if m:
            loudness, peak = m
            gain = min(cfg.lufs - loudness, cfg.peak - peak)
            filters.append(f"volume={gain:.2f}dB")
        if fallback and cfg.fade > 0:
            fade = min(cfg.fade, duration / 2)
            filters.append(f"afade=t=out:st={duration - fade:.3f}:d={fade:.3f}")

        cmd = [cfg.ffmpeg, "-hide_banner", "-nostats", "-y", "-i", str(wav),
               "-map_metadata", "-1", "-af", ",".join(filters),
               "-c:a", "libopus", "-b:a", f"{cfg.bitrate}k", "-vbr", "on",
               "-application", "audio"]
        for k, v in build_metadata(task, renderer).items():
            cmd += ["-metadata", f"{k}={v}"]
        cmd += ["-f", "opus", str(part)]
        try:
            run(cmd, timeout, "ffmpeg (encoding)")
            os.replace(part, task.dst)   # atomic write: no truncated file left behind
        finally:
            part.unlink(missing_ok=True)

    notes = [renderer, f"{duration:.1f}s"]
    if render_error:
        notes.append(f"after failure of {task.renderer}")
    if rendered < duration - 0.5:
        notes.append(f"render truncated to {rendered:.1f}s")
    if fallback:
        notes.append("fallback duration")
    if not m:
        notes.append("not normalized (silent/too short)")
    elif loudness + gain < cfg.lufs - 0.5:
        notes.append(f"gain limited by peaks: {loudness + gain:.1f} LUFS")
    return ", ".join(notes)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def output_path(cfg, rel: Path, subtune: int, total: int) -> Path:
    base = cfg.dest / rel.parent
    if total == 1:
        return base / f"{rel.stem}.opus"
    width = max(2, len(str(total)))
    return base / f"{rel.stem}_{subtune:0{width}d}.opus"


def in_range(cfg, duration: float) -> bool:
    """Is the effective duration (tag or fallback) within [--min-duration, --max-duration]?"""
    return (duration >= cfg.min_duration
            and (not cfg.max_duration or duration <= cfg.max_duration))


def find_sndh(src: Path) -> list[Path]:
    return sorted(p for p in src.rglob("*")
                  if p.is_file() and p.suffix.lower() == ".sndh" and not p.name.startswith("."))


def load_patterns(path: Path | None) -> list[str]:
    if not path:
        return []
    lines = (l.strip() for l in path.read_text(encoding="utf-8").splitlines())
    return [l for l in lines if l and not l.startswith("#")]


def pick_renderer(cfg, rel: Path) -> str:
    r = rel.as_posix()
    for renderer, patterns in cfg.patterns.items():
        if any(fnmatch(r, p) for p in patterns):
            return renderer
    return cfg.renderer


def check_tools(cfg) -> None:
    # psgplay is always needed (tags, durations); sc68 is used for rendering and as a fallback.
    tools = [cfg.psgplay, cfg.sc68, cfg.ffmpeg]
    missing = [t for t in tools if not shutil.which(t)]
    if missing:
        sys.exit("Missing tool(s): " + ", ".join(missing) + "\n"
                 "  ffmpeg  : sudo apt install ffmpeg\n"
                 "  psgplay : git clone --recurse-submodules https://github.com/frno7/psgplay"
                 " && make -C psgplay psgplay && install -m755 psgplay/psgplay ~/.local/bin/\n"
                 "  sc68    : nix profile add nixpkgs#sc68")
    enc = subprocess.run([cfg.ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True)
    if "libopus" not in enc.stdout:
        sys.exit("ffmpeg was not built with libopus.")


def setup_logging(cfg) -> None:
    log.setLevel(logging.DEBUG)
    console = logging.StreamHandler()
    console.setLevel(logging.DEBUG if cfg.verbose else logging.INFO)
    console.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(console)
    if not cfg.dry_run:
        cfg.log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(cfg.log_file, encoding="utf-8")
        fh.setLevel(logging.WARNING)
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(fh)


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Recursively converts SNDH files to Opus (one file per sub-tune).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("src", type=Path, help="source folder (walked recursively)")
    p.add_argument("dest", type=Path, help="output folder (tree structure reproduced)")
    p.add_argument("-b", "--bitrate", type=int,
                   help="Opus bitrate in kbps (default: 48 mono, 80 stereo)")
    p.add_argument("-s", "--stereo", action="store_true",
                   help="stereo output with PSG channel spatialization")
    p.add_argument("--balance", default="-0.4:0:+0.4",
                   help="A:B:C balance of PSG channels in stereo, psgplay only "
                        "(-1 left, +1 right)")
    p.add_argument("-r", "--renderer", choices=sorted(RENDERERS), default="sc68",
                   help="emulator used for audio rendering; the other one is used as a "
                        "fallback on failure")
    p.add_argument("--ym-engine", choices=["blep", "pulse"], default="blep",
                   help="sc68's YM engine: blep (better quality) or pulse "
                        "(~3x faster, spectral aliasing)")
    for r in sorted(RENDERERS):
        p.add_argument(f"--{r}-list", type=Path, metavar="FILE",
                       help=f"patterns (one per line, paths relative to src, wildcards allowed) "
                            f"of SNDH files to render with {r} regardless of --renderer")
    p.add_argument("-d", "--fallback", type=float, default=180,
                   help="fallback duration in seconds if the SNDH doesn't specify one")
    p.add_argument("--skip-unknown", action="store_true",
                   help="skip sub-tunes with no known duration (instead of the fallback duration)")
    p.add_argument("--min-duration", type=float, default=90,
                   help="skip sub-tunes shorter than this (s); 0 to disable")
    p.add_argument("--max-duration", type=float, default=240,
                   help="skip sub-tunes longer than this (s); 0 to disable")
    p.add_argument("--fade", type=float, default=10,
                   help="fade-out duration (s), only applied when using the fallback duration")
    p.add_argument("--lufs", type=float, default=-16, help="target integrated loudness (LUFS)")
    p.add_argument("--peak", type=float, default=-1.5,
                   help="max peak after normalization (dBFS): caps the gain")
    p.add_argument("-j", "--jobs", type=int, default=os.cpu_count() or 1,
                   help="number of parallel conversions")
    p.add_argument("-f", "--force", action="store_true", help="reconvert even if the output already exists")
    p.add_argument("-n", "--dry-run", action="store_true", help="list what would be converted")
    p.add_argument("--log-file", type=Path, help="error log file (default: <dest>/sndh2opus.log)")
    p.add_argument("--psgplay", default="psgplay", help="path to psgplay")
    p.add_argument("--sc68", default="sc68", help="path to sc68")
    p.add_argument("--ffmpeg", default="ffmpeg", help="path to ffmpeg")
    p.add_argument("-v", "--verbose", action="store_true", help="also show skipped files")
    cfg = p.parse_args(argv)
    if cfg.bitrate is None:
        cfg.bitrate = 80 if cfg.stereo else 48
    if not 6 <= cfg.bitrate <= 510:
        p.error("Opus bitrate must be between 6 and 510 kbps")
    if cfg.fallback <= 0 or cfg.jobs < 1:
        p.error("--fallback and --jobs must be positive")
    if cfg.max_duration and cfg.min_duration > cfg.max_duration:
        p.error("--min-duration must be less than --max-duration")
    if not cfg.src.is_dir():
        p.error(f"source folder not found: {cfg.src}")
    cfg.src, cfg.dest = cfg.src.resolve(), cfg.dest.resolve()
    cfg.log_file = cfg.log_file or cfg.dest / "sndh2opus.log"
    cfg.patterns = {}
    for r in RENDERERS:
        try:
            cfg.patterns[r] = load_patterns(getattr(cfg, f"{r}_list"))
        except OSError as e:
            p.error(f"--{r}-list unreadable: {e}")
    return cfg


def main(argv=None) -> int:
    cfg = parse_args(argv)
    setup_logging(cfg)
    check_tools(cfg)

    files = find_sndh(cfg.src)
    log.info("%d SNDH files found in %s", len(files), cfg.src)

    failed = 0
    lock = threading.Lock()

    def fail(label: str, err: Exception) -> None:
        nonlocal failed
        with lock:
            failed += 1
        log.error("FAILED %s: %s", label, err)

    # 1. Read the tags (fast) and build the list of sub-tunes.
    tasks: list[Task] = []
    skipped = out_of_range = unknown = 0
    with ThreadPoolExecutor(cfg.jobs) as pool:
        futures = {pool.submit(read_info, cfg, f): f for f in files}
        for fut in as_completed(futures):
            f = futures[fut]
            rel = f.relative_to(cfg.src)
            try:
                info = fut.result()
            except Exception as e:
                fail(str(rel), e)
                continue
            for n in range(1, info.subtunes + 1):
                if info.duration(n) is None and cfg.skip_unknown:
                    unknown += 1
                    log.debug("unknown duration: %s #%d", rel, n)
                    continue
                duration = info.duration(n) or cfg.fallback
                if not in_range(cfg, duration):
                    out_of_range += 1
                    log.debug("out of range (%.1fs): %s #%d", duration, rel, n)
                    continue
                dst = output_path(cfg, rel, n, info.subtunes)
                if dst.exists() and not cfg.force:
                    skipped += 1
                    log.debug("already present: %s", dst)
                    continue
                tasks.append(Task(f, rel, dst, n, info, pick_renderer(cfg, rel)))
    tasks.sort(key=lambda t: (str(t.rel), t.subtune))
    log.info("%d sub-tunes to convert, %d already present, %d out of duration range, "
             "%d skipped for unknown duration", len(tasks), skipped, out_of_range, unknown)

    if cfg.dry_run:
        for t in tasks:
            d = t.info.duration(t.subtune)
            log.info("%s -> %s (%s, %s)", t.label, t.dst.relative_to(cfg.dest), t.renderer,
                     f"{d:.1f}s" if d else f"fallback {cfg.fallback:.0f}s")
        return 0

    # 2. Convert in parallel.
    done = ok = 0
    start = time.monotonic()
    pool = ThreadPoolExecutor(cfg.jobs)
    try:
        futures = {pool.submit(convert, cfg, t): t for t in tasks}
        for fut in as_completed(futures):
            t = futures[fut]
            done += 1
            try:
                notes = fut.result()
                ok += 1
                log.info("[%d/%d] OK %s (%s)", done, len(tasks), t.label, notes)
            except Exception as e:
                fail(t.label, e)
    except KeyboardInterrupt:
        log.warning("Interrupted: stopping after in-progress conversions…")
        pool.shutdown(wait=True, cancel_futures=True)
        return 130
    pool.shutdown()

    elapsed = time.monotonic() - start
    log.info("Done in %.0f s: %d converted, %d already present, %d failed",
             elapsed, ok, skipped, failed)
    if failed:
        log.info("Failure details: %s", cfg.log_file)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
