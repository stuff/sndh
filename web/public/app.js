// Minimal player for the SNDH radio: plays the Icecast stream and shows the
// current track from the scheduler API.
"use strict";

const config = Object.assign(
  { streamUrl: "/atari-st.opus", apiUrl: "", streamDelayS: 8 },
  window.RADIO_CONFIG,
);

// Refresh period of the track info.
const POLL_MS = 10_000;
// Number of past tracks listed under the player.
const HISTORY_SIZE = 10;
const VOLUME_KEY = "radio.volume";

const $ = (id) => document.getElementById(id);
const player = document.querySelector(".player");
const audio = $("audio");
const playButton = $("play");
const volume = $("volume");

// "stopped" | "loading" | "playing"
let state = "stopped";
// Latest plays from the API, most recent first.
let plays = [];

function setState(next) {
  state = next;
  player.dataset.state = next;
  playButton.setAttribute("aria-label", next === "stopped" ? "Play" : "Stop");
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = next === "stopped" ? "paused" : "playing";
  }
  render();
}

function showNotice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

// --- Playback --------------------------------------------------------------

function play() {
  showNotice("");
  setState("loading");
  // Always reconnect to the live edge (a paused live stream would lag behind).
  audio.src = `${config.streamUrl}${config.streamUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
  audio.play().catch((err) => {
    if (err.name !== "AbortError") fail("Playback could not start.");
  });
}

function stop() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  setState("stopped");
}

function fail(message) {
  stop();
  showNotice(message);
}

playButton.addEventListener("click", () => (state === "stopped" ? play() : stop()));

audio.addEventListener("playing", () => setState("playing"));
audio.addEventListener("waiting", () => state !== "stopped" && setState("loading"));
audio.addEventListener("error", () => {
  if (state !== "stopped") fail("The stream is unreachable right now. Try again in a moment.");
});
// A live stream only ends if the server dropped it: reconnect.
audio.addEventListener("ended", () => {
  if (state !== "stopped") setTimeout(play, 2000);
});

try {
  const saved = Number.parseFloat(localStorage.getItem(VOLUME_KEY));
  if (saved >= 0 && saved <= 1) volume.value = String(saved);
} catch {}
audio.volume = Number(volume.value);
volume.addEventListener("input", () => {
  audio.volume = Number(volume.value);
  try {
    localStorage.setItem(VOLUME_KEY, volume.value);
  } catch {}
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", play);
  navigator.mediaSession.setActionHandler("pause", stop);
  navigator.mediaSession.setActionHandler("stop", stop);
}

if (!audio.canPlayType('audio/ogg; codecs="opus"')) {
  showNotice("This browser cannot play Ogg Opus streams. Try Firefox, Chrome or a recent Safari.");
}

// --- Track info --------------------------------------------------------------

// Listeners hear the stream a few seconds after the server plays it (Icecast
// burst + buffering), so while playing, track changes are shown with that lag.
function currentPlay(now) {
  const lagMs = state === "playing" ? config.streamDelayS * 1000 : 0;
  const heard = plays.find((p) => Date.parse(p.started_at) + lagMs <= now);
  return { play: heard ?? plays[plays.length - 1], lagMs };
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "–:––";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let shownTrackId = null;

function render() {
  const now = Date.now();
  const { play: current, lagMs } = currentPlay(now);
  if (!current) return;
  const t = current.track;

  if (t.id !== shownTrackId) {
    shownTrackId = t.id;
    const title = t.title ?? t.path;
    $("title").textContent = title;
    $("artist").textContent = t.artist ?? "Unknown composer";
    $("meta").textContent = [t.album !== t.title ? t.album : null, t.date, t.hardware]
      .filter(Boolean)
      .join(" · ") || " ";
    document.title = `${title} — ${t.artist ?? "Chiptune Radio"}`;
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: t.artist ?? "",
        album: t.album ?? "Chiptune Radio",
      });
    }
  }

  const elapsed = (now - Date.parse(current.started_at) - lagMs) / 1000;
  const duration = t.duration_s ?? NaN;
  $("elapsed").textContent = formatTime(Math.min(elapsed, duration || elapsed));
  $("duration").textContent = formatTime(duration);
  $("bar").style.width = duration > 0 ? `${Math.min(100, (elapsed / duration) * 100)}%` : "0";

  renderHistory(current);
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
let shownHistoryKey = "";

// Past tracks: everything older than the one currently heard.
function renderHistory(current) {
  const past = plays.slice(plays.indexOf(current) + 1, plays.indexOf(current) + 1 + HISTORY_SIZE);
  const key = past.map((p) => p.started_at).join();
  if (key === shownHistoryKey) return;
  shownHistoryKey = key;

  const list = $("history");
  list.replaceChildren(
    ...past.map((p) => {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = p.started_at;
      time.textContent = timeFormat.format(new Date(p.started_at));
      const title = document.createElement("span");
      title.className = "history-title";
      title.textContent = p.track.title ?? p.track.path;
      const artist = document.createElement("span");
      artist.className = "history-artist";
      artist.textContent = p.track.artist ?? "Unknown composer";
      item.append(time, title, artist);
      return item;
    }),
  );
  $("history-section").hidden = past.length === 0;
}

async function refresh() {
  try {
    // +2: the current track, and one the server already plays but listeners
    // don't hear yet (see currentPlay).
    const res = await fetch(`${config.apiUrl}/api/history?limit=${HISTORY_SIZE + 2}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    plays = await res.json();
    if (plays.length === 0) $("title").textContent = "Nothing played yet";
    render();
  } catch {
    if (plays.length === 0) $("title").textContent = "Track info unavailable";
  }
}

refresh();
setInterval(refresh, POLL_MS);
setInterval(render, 1000);
