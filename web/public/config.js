// Runtime configuration. In the Docker image this file is regenerated at
// startup from the STREAM_URL, API_URL and STREAM_DELAY_S environment
// variables (see docker/40-radio-config.sh); these defaults target a local
// server/ stack.
window.RADIO_CONFIG = {
  streamUrl: "http://localhost:8000/atari-st.opus",
  apiUrl: "http://localhost:3000",
  streamDelayS: 8,
};
