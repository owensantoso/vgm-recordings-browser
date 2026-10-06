import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
// DOM lifecycle coverage; actual media/geometry is exercised in browser tests.
test("one provider survives browsing and empty search, separate sources replace it", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://example.test/?session=2026-05-31-shimokitazawa-first-vgm-session#IMG_7796",
  });
  for (const key of [
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
  ])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const csv = readFileSync("data/recordings.csv", "utf8"),
    catalog = readFileSync("data/catalog.json", "utf8");
  globalThis.fetch = async (url) =>
    new Response(String(url).includes("catalog.json") ? catalog : csv);
  const audios: FakeAudio[] = [];
  class FakeAudio {
    currentTime = 0;
    duration = 470;
    paused = true;
    removed = false;
    deferPlay = false;
    pendingPlay: { resolve(): void; reject(reason: Error): void }[] = [];
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
      if (this.deferPlay) {
        return new Promise<void>((resolve, reject) => {
          this.pendingPlay.push({
            resolve: () => { this.onplay?.(); resolve(); },
            reject,
          });
        });
      }
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
  const players: FakeVideo[] = [];
  class FakeVideo {
    time = 0;
    state = 5;
    destroyed = false;
    constructor(
      _host,
      public options,
    ) {
      players.push(this);
      queueMicrotask(() => options.events.onReady());
    }
    playVideo() {
      this.state = 1;
      this.options.events.onStateChange({ data: 1 });
    }
    pauseVideo() {
      this.state = 2;
      this.options.events.onStateChange({ data: 2 });
    }
    seekTo(t) {
      this.time = t;
      if (this.state !== 2) this.playVideo();
    }
    cueVideoById({ startSeconds }) {
      this.time = startSeconds;
      this.state = 5;
    }
    getPlayerState() {
      return this.state;
    }
    getCurrentTime() {
      return this.time;
    }
    getDuration() {
      return 300;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  dom.window.YT = { Player: FakeVideo };
  const root = createRoot(document.getElementById("root")!);
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const click = async (selector: string) =>
    act(async () => {
      const node = document.querySelector(selector) as HTMLElement;
      assert.ok(node, selector);
      node.click();
      await settle();
    });
  try {
    await act(async () => {
      root.render(<App />);
      await settle();
    });
    assert.equal(audios.length, 1);
    assert.equal(audios[0].paused, true);
    assert.equal(audios[0].currentTime, 158);
    assert.equal(location.hash, "");
    audios[0].deferPlay = true;
    await click(".play-button");
    await click(".play-button");
    assert.equal(audios[0].paused, true, "Pause cancels intent before the native play event arrives");
    await act(async () => {
      audios[0].pendingPlay[0].reject(new dom.window.DOMException("Paused pending playback", "AbortError"));
      await settle();
    });
    assert.equal(document.querySelector(".mode-status")!.textContent, "Paused");
    assert.equal(document.querySelector(".playback-error"), null);
    await click(".play-button");
    await click(".play-button");
    await click(".play-button");
    await act(async () => {
      audios[0].pendingPlay[1].reject(new dom.window.DOMException("Older interrupted request", "AbortError"));
      await settle();
    });
    assert.equal(document.querySelector(".playback-error"), null, "An older play rejection cannot fail newer active intent");
    await act(async () => { audios[0].pendingPlay[2].resolve(); await settle(); });
    assert.equal(document.querySelector(".mode-status")!.textContent, "Playing");
    await click(".play-button");
    audios[0].deferPlay = false;
    await click(".play-button");
    assert.equal(audios[0].paused, false);
    await click('.workspace-nav a[href*="view=songs"]');
    await click('.song-list a[href*="song=vgm-yoshi-circuit-double-dash"]');
    await click('.song-tabs button:nth-child(2)');
    assert.equal(document.querySelectorAll(".recording-row").length, 2);
    assert.equal(audios.length, 1);
    assert.equal(audios[0].paused, false);
    await click('.workspace-nav a[href*="view=repertoire"]');
    assert.match(
      document.querySelector(".catalog-empty")!.textContent!,
      /No repertoire selected/,
    );
    assert.equal(audios[0].paused, false);
    await act(async () => {
      const input = document.querySelector(
        "input[type=search]",
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "no matching song");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle();
    });
    assert.equal(audios.length, 1);
    assert.equal(audios[0].removed, false);
    await click('.media-switch button:not(.repeat-quick)[aria-pressed="false"]');
    assert.equal(audios[0].removed, true);
    assert.equal(players.length, 1);
    assert.equal(players[0].state, 1);
    assert.equal(players[0].time, 158);
    await click('.media-switch button[aria-pressed="false"]');
    await click(".play-button");
    audios[1].deferPlay = true;
    await click(".play-button");
    await act(async () => {
      audios[1].pendingPlay[0].reject(new dom.window.DOMException("Active playback denied", "NotAllowedError"));
      await settle();
    });
    assert.equal(document.querySelector(".mode-status")!.textContent, "Unavailable");
    assert.match(document.querySelector(".playback-error")!.textContent!, /Playback could not start/);
    await act(async () => root.unmount());
    assert.equal(players[0].destroyed, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
