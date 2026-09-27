# SNDH radio: asks the scheduler for each next track, crossfades them and
# sends a single continuous Ogg Opus stream to Icecast.

settings.log.stdout := true
settings.log.file := false
settings.log.level := int_of_string(environment.get("LOG_LEVEL", default="3"))

# The library and the stream are mono. Without this, internal sources
# (crossfade transitions, silence) default to stereo and the mismatch makes
# the script fail at runtime on the first track change.
settings.frame.audio.channels := 1

def env(name, default) =
  environment.get(name, default=default)
end

music_dir = env("MUSIC_DIR", "/music")
scheduler_url = env("SCHEDULER_URL", "http://scheduler:3001")
crossfade_s = float_of_string(env("CROSSFADE_S", "3"))
opus_bitrate = int_of_string(env("OPUS_BITRATE", "64"))

# No default password: refuse to start rather than use a well-known one.
icecast_password = env("ICECAST_SOURCE_PASSWORD", "")
if icecast_password == "" then
  error.raise(error.register("config"), "ICECAST_SOURCE_PASSWORD must be set")
end

# Next track, chosen by the scheduler. On any failure it returns null and
# request.dynamic retries later; meanwhile the fallback below plays.
# Note: an unreachable scheduler does not raise, http.get returns status 523.
def next_track() =
  try
    resp = http.get(timeout=5., "#{scheduler_url}/internal/next")
    if resp.status_code == 200 then
      request.create("#{music_dir}/#{resp}")
    else
      log.important("scheduler: no track (HTTP #{resp.status_code}), using fallback")
      null
    end
  catch err do
    log.important("scheduler: unreachable (#{err.message})")
    null
  end
end

scheduled = request.dynamic(id="scheduled", prefetch=1, retry_delay={10.}, next_track)

# Random playlist of the whole library, used whenever the scheduler is down
# or has nothing to offer. Switches back to the scheduler at the next track.
backup = playlist(id="backup", mode="random", reload_mode="never", music_dir)

radio = fallback(id="radio", [scheduled, backup])

# Tell the scheduler what actually starts playing (fallback tracks included),
# so its now-playing and history match what listeners hear.
radio.on_track(synchronous=false, fun (m) -> begin
  filename = m["filename"]
  if filename != "" then
    try
      ignore(http.post(timeout=5., data=filename, "#{scheduler_url}/internal/started"))
    catch err do
      log.important("scheduler: cannot report track start (#{err.message})")
    end
  end
end)

radio = crossfade(duration=crossfade_s + 2., fade_in=crossfade_s, fade_out=crossfade_s, radio)

# Silence rather than a stopped stream if everything fails.
radio = mksafe(radio)

# Drop metadata before encoding: the Ogg encoder starts a new chained
# logical stream on each metadata change, which some browsers (Chrome) stop
# playing at. Now-playing information comes from the scheduler API instead.
radio = source.drop.metadata(radio)

output.icecast(
  %ogg(%opus(bitrate=opus_bitrate, channels=1, samplerate=48000, application="audio")),
  host=env("ICECAST_HOST", "icecast"),
  port=int_of_string(env("ICECAST_PORT", "8000")),
  password=icecast_password,
  mount=env("ICECAST_MOUNT", "radio.opus"),
  name=env("RADIO_NAME", "SNDH Radio"),
  description=env("RADIO_DESCRIPTION", "Atari ST chiptunes from the SNDH archive"),
  genre="Chiptune",
  public=false,
  radio
)
