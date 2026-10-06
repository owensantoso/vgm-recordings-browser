import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";

// These are DOM/lifecycle tests, not browser rendering or media-provider evidence.
test("React preserves playback through filters and mode switches, and tears down on empty results", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://example.test/archive/?session=2026-05-31-shimokitazawa-first-vgm-session#IMG_7796",
  });
  const globals = [
    "window",
    "document",
    "location",
    "history",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
  ];
  for (const key of globals)
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const csv = readFileSync("data/recordings.csv", "utf8");
  const catalog = readFileSync('data/catalog.json', 'utf8');
  globalThis.fetch = async (url) => new Response(String(url).includes('catalog.json') ? catalog : csv);
  dom.window.scrollTo = () => {};
  const players: FakeVideo[] = [];
  class FakeVideo {
    time = 0;
    destroyed = false;
    playing = false;
    state = 5;
    constructor(
      _host,
      public options,
    ) {
      players.push(this);
      queueMicrotask(() => options.events.onReady());
    }
    playVideo() {
      this.state = 1;
      this.playing = true;
      this.options.events.onStateChange({ data: 1 });
    }
    pauseVideo() {
      this.state = 2;
      this.playing = false;
      this.options.events.onStateChange({ data: 2 });
    }
    seekTo(time) {
      this.time = time;
      if (this.state !== 2) this.playVideo();
    }
    cueVideoById({ startSeconds }) { this.time = startSeconds; this.state = 5; this.playing = false; }
    getPlayerState() { return this.state; }
    getCurrentTime() {
      return this.time;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  dom.window.YT = { Player: FakeVideo };
  const audios: FakeAudio[] = [];
  class FakeAudio {
    currentTime = 0;
    paused = true;
    removed = false;
    onloadedmetadata;
    onplay;
    onpause;
    onended;
    onerror;
    constructor() {
      audios.push(this);
      queueMicrotask(() => this.onloadedmetadata?.());
    }
    async play() {
      this.paused = false;
      this.onplay?.();
    }
    pause() {
      this.paused = true;
      this.onpause?.();
    }
    removeAttribute() {
      this.removed = true;
    }
    load() {}
  }
  globalThis.Audio = FakeAudio;
  const root = createRoot(document.getElementById("root")!);
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    );
    assert.ok(button, label);
    await act(async () => {
      button.click();
      await settle();
    });
  };
  try {
    await act(async () => {
      root.render(<App />);
      await settle();
    });
    assert.equal(document.querySelectorAll(".recording-row").length, 13);
    assert.equal(
      document.querySelector(".player h2")?.textContent,
      "Beneath the mask",
    );
    assert.equal(players[0].time, 158);
    assert.equal(players[0].playing, false);
    await click("Play");
    assert.equal(players[0].playing, true);
    players[0].time = 200;
    await click("Audio");
    assert.equal(players[0].destroyed, true);
    assert.equal(audios[0].currentTime, 200);
    assert.equal(audios[0].paused, false);
    await click("Video");
    assert.equal(audios[0].removed, true);
    assert.equal(players[1].time, 200);
    assert.equal(players[1].playing, true);
    await click("Pause");
    const navigate = async (selector: string) => act(async () => {
      (document.querySelector(selector) as HTMLAnchorElement).click();
      await settle();
    });
    await navigate('.workspace-nav a[href*="view=songs"]');
    await navigate('.song-list a[href*="song=vgm-yoshi-circuit-double-dash"]');
    assert.equal(document.querySelectorAll('.song-take').length, 2, 'song IDs join takes across sessions');
    assert.equal(players[1].destroyed, false, 'song navigation preserves the current player');
    await navigate('.workspace-nav a[href*="view=repertoire"]');
    assert.match(document.querySelector('.catalog-empty')!.textContent!, /No repertoire selected/);
    assert.equal(players[1].destroyed, false, 'empty repertoire does not dispose the selected player');
    await navigate('.workspace-nav a:not([href*="view="])');
    await click("Beneath the mask");
    assert.equal(
      players[1].playing,
      true,
      "reselecting the current take plays it",
    );
    const persona = [...document.querySelectorAll(".game-links button")].find(
      (b) => b.textContent === "Persona",
    )!;
    await act(async () => {
      persona.click();
      await settle();
    });
    assert.equal(document.querySelectorAll(".recording-row").length, 1);
    assert.equal(
      players[1].destroyed,
      false,
      "filtering around the active row must not rebuild its player",
    );
    await click("Select");
    await click("Select all shown");
    assert.equal(
      document.querySelectorAll("input[type=checkbox]:checked").length,
      1,
    );
    const media = [...document.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.value === "audio-only"),
    )!;
    await act(async () => {
      media.value = "audio-only";
      media.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await settle();
    });
    assert.equal(document.querySelectorAll(".recording-row").length, 0);
    assert.equal(document.querySelector(".player"), null);
    assert.equal(
      players[1].destroyed,
      true,
      "empty results release the media backend",
    );
    assert.equal(
      document.querySelectorAll("input[type=checkbox]:checked").length,
      0,
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
