import { describe, expect, test } from "bun:test";
import { parseListeners } from "./icecast";

const source = (mount: string, listeners: number) => ({
  listenurl: `http://radio.example.com:8000/${mount}`,
  listeners,
});

describe("parseListeners", () => {
  test("single live mount (object)", () => {
    expect(parseListeners({ icestats: { source: source("atari-st.opus", 3) } }, "atari-st.opus")).toBe(3);
  });

  test("several live mounts (array)", () => {
    const status = { icestats: { source: [source("other.opus", 9), source("atari-st.opus", 0)] } };
    expect(parseListeners(status, "atari-st.opus")).toBe(0);
  });

  test("mount not live, or unexpected payload", () => {
    expect(parseListeners({ icestats: { dummy: null } }, "atari-st.opus")).toBeNull();
    expect(parseListeners({ icestats: { source: source("other.opus", 2) } }, "atari-st.opus")).toBeNull();
    expect(parseListeners(null, "atari-st.opus")).toBeNull();
    expect(parseListeners("oops", "atari-st.opus")).toBeNull();
  });

  test("does not match a mount that merely ends the same way", () => {
    expect(parseListeners({ icestats: { source: source("xatari-st.opus", 5) } }, "atari-st.opus")).toBeNull();
  });
});
