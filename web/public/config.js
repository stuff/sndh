// Runtime configuration. In the Docker image this file is regenerated at
// startup from the STREAM_URL, API_URL and STREAM_DELAY_S environment
// variables (see docker/40-radio-config.sh). The defaults are same-origin:
// the image's nginx proxies the stream and /api/ to the other containers.
window.RADIO_CONFIG = {
  streamUrl: "/atari-st.opus",
  apiUrl: "",
  streamDelayS: 8,
};
