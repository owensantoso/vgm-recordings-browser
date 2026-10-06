// Synthetic archive used by the real-browser tests. Nothing here touches the
// committed CSV, audio, or thumbnails: every byte is generated at test time.
import { spawnSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { build } from "esbuild";
import { readFile, stat } from "node:fs/promises";

export const SESSION_A = "2026-05-31-synthetic-first-session";
export const SESSION_B = "2026-07-26-synthetic-second-session";

const columns = [
  "file",
  "caption",
  "length",
  "duration_seconds",
  "size_mb",
  "resolution",
  "rotation",
  "recorded_create_date",
  "download_modified",
  "device",
  "video_file_id",
  "video_url",
  "audio_file",
  "audio_format",
  "audio_size_mb",
  "audio_file_id",
  "audio_url",
  "has_video",
  "has_audio",
  "thumbnail",
  "session_id",
  "session_label",
  "tags",
  "youtube_playlist_id",
  "youtube_playlist_url",
  "youtube_video_id",
  "youtube_url",
  "drums",
  "piano",
  "guitar",
  "bass",
  "song_name",
  "franchise",
  "game_title",
  "section_start",
  "section_end",
];

function row(overrides) {
  return {
    file: "",
    caption: "",
    length: "0:06",
    duration_seconds: "6",
    size_mb: "1",
    resolution: "160 x 120",
    rotation: "0",
    recorded_create_date: "2026-05-31 16:00:00",
    download_modified: "",
    device: "Synthetic device",
    video_file_id: "",
    video_url: "",
    audio_file: "",
    audio_format: "PCM (.wav)",
    audio_size_mb: "0.1",
    audio_file_id: "",
    audio_url: "",
    has_video: "no",
    has_audio: "yes",
    thumbnail: "thumbs/synthetic.png",
    session_id: SESSION_A,
    session_label: "2026-05-31 Synthetic First Session",
    tags: "synthetic",
    youtube_playlist_id: "",
    youtube_playlist_url: "",
    youtube_video_id: "",
    youtube_url: "",
    drums: "Ada",
    piano: "Ben",
    guitar: "",
    bass: "",
    song_name: "",
    franchise: "",
    game_title: "",
    section_start: "",
    section_end: "",
    ...overrides,
  };
}

// Five takes across two sessions exercise every media branch the player has.
export const rows = [
  row({
    file: "SYN_0001.MOV",
    caption: "Alpha section take",
    recorded_create_date: "2026-05-31 16:00:01",
    has_video: "yes",
    youtube_video_id: "synthetic-alpha",
    audio_file: "SYN_0001.wav",
    franchise: "Alpha Quest",
    game_title: "Alpha Quest II",
    section_start: "0:02",
    section_end: "0:05",
  }),
  row({
    file: "SYN_0002.MOV",
    caption: "Bravo full take",
    recorded_create_date: "2026-05-31 16:00:02",
    has_video: "yes",
    youtube_video_id: "synthetic-bravo",
    audio_file: "SYN_0002.wav",
    franchise: "Bravo Racer",
    game_title: "Bravo Racer",
  }),
  row({
    file: "SYN_0003.m4a",
    caption: "Charlie short audio",
    recorded_create_date: "2026-05-31 16:00:03",
    length: "0:03",
    duration_seconds: "3",
    audio_file: "SYN_0003.wav",
    franchise: "Charlie Chorus",
    game_title: "Charlie Chorus",
    guitar: "Cy",
  }),
  row({
    file: "SYN_0004.m4a",
    caption: "Delta missing audio",
    recorded_create_date: "2026-07-26 16:00:04",
    session_id: SESSION_B,
    session_label: "2026-07-26 Synthetic Second Session",
    audio_file: "SYN_0004-missing.wav",
    franchise: "Delta Drift",
    game_title: "Delta Drift",
  }),
  row({
    file: "SYN_0005.MOV",
    caption: "Echo broken video",
    recorded_create_date: "2026-07-26 16:00:05",
    session_id: SESSION_B,
    session_label: "2026-07-26 Synthetic Second Session",
    has_video: "yes",
    youtube_video_id: "broken",
    audio_file: "SYN_0005.wav",
    franchise: "Echo Valley",
    game_title: "Echo Valley",
  }),
];

function csv() {
  const escape = (value) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [
    columns.join(","),
    ...rows.map((record) =>
      columns.map((key) => escape(record[key])).join(","),
    ),
  ].join("\n");
}

function wav(seconds, frequency = 440, rate = 8000) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 8000),
      44 + i * 2,
    );
  return buffer;
}

// 1x1 opaque PNG so thumbnails resolve without any committed image.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function video(target) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=8000",
      "-t",
      "6",
      "-c:v",
      "libvpx",
      "-b:v",
      "100k",
      "-c:a",
      "libvorbis",
      "-shortest",
      "-y",
      target,
    ],
    { stdio: "ignore" },
  );
  if (result.status === 0) return "video.webm";
  // Without ffmpeg the fake provider still drives a real <video> element,
  // just with an audio-only source.
  await writeFile(target.replace(/webm$/, "wav"), wav(6, 330));
  return "video.wav";
}

// Stands in for https://www.youtube.com/iframe_api: same constructor and event
// contract, backed by a real <video> element so play/pause/seek/ended/error
// come from the browser's media pipeline. Destroyed players can be poked with
// __fireStale() to prove the app ignores callbacks from disposed providers.
function youtubeApi(videoSource) {
  return `(() => {
  const media = (window.__media ||= []);
  const players = (window.__youtubePlayers ||= []);
  class Player {
    constructor(host, options) {
      const video = document.createElement("video");
      video.dataset.kind = "youtube";
      video.dataset.videoId = options.videoId;
      video.playsInline = true;
      video.style.width = "100%";
      video.src = options.videoId === "broken" ? "missing.webm" : ${JSON.stringify(videoSource)};
      host.append(video);
      this.video = video;
      this.options = options;
      this.destroyed = false;
      this.state = 5;
      media.push(video);
      players.push(this);
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = Number(options.playerVars.start) || 0;
        options.events.onReady();
      });
      video.addEventListener("play", () => { this.state = 1; options.events.onStateChange({ data: 1 }); });
      video.addEventListener("pause", () => {
        this.state = 2;
        if (!video.ended) options.events.onStateChange({ data: 2 });
      });
      video.addEventListener("ended", () => { this.state = 0; options.events.onStateChange({ data: 0 }); });
      video.addEventListener("error", () => options.events.onError());
    }
    playVideo() { this.cuedPosition = undefined; this.video.play().catch(() => {}); }
    pauseVideo() { this.video.pause(); }
    seekTo(time) { this.video.currentTime = time; if (this.state !== 2) this.playVideo(); }
    cueVideoById({startSeconds}) { this.video.pause(); this.video.currentTime = startSeconds; this.cuedPosition = startSeconds; this.state = 2; }
    getPlayerState() { return this.state; }
    getCurrentTime() { return this.cuedPosition === undefined ? this.video.currentTime : 0; }
    getDuration() { return this.video.duration; }
    destroy() {
      this.destroyed = true;
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video.remove();
    }
  }
  window.__fireStale = () => {
    let fired = 0;
    for (const player of players) {
      if (!player.destroyed) continue;
      player.options.events.onReady();
      player.options.events.onStateChange({ data: 1 });
      player.options.events.onError();
      fired++;
    }
    return fired;
  };
  window.YT = { Player };
  window.onYouTubeIframeAPIReady?.();
})();`;
}

// Runs before any app code: every Audio() the player creates is recorded so
// tests can prove which elements still hold a source and which are playing.
export const initScript = `(() => {
  const media = (window.__media ||= []);
  const Original = window.Audio;
  function Audio(src) {
    const element = src === undefined ? new Original() : new Original(src);
    element.dataset.kind = "audio";
    media.push(element);
    return element;
  }
  Audio.prototype = Original.prototype;
  window.Audio = Audio;
  window.__mediaState = () =>
    media.map((element) => ({
      kind: element.dataset.kind,
      src: element.getAttribute("src") || "",
      paused: element.paused,
      ready: element.readyState >= 1,
      ended: element.ended,
      time: element.currentTime,
      attached: element.isConnected,
    }));
})();`;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

export async function createFixture(directory) {
  await mkdir(join(directory, "data"), { recursive: true });
  await mkdir(join(directory, "audio"), { recursive: true });
  await mkdir(join(directory, "thumbs"), { recursive: true });
  await writeFile(join(directory, "data", "recordings.csv"), csv());
  await writeFile(
    join(directory, "data", "catalog.json"),
    JSON.stringify({
      version: 2,
      songs: [
        {
          id: "synthetic-alpha",
          title: "Alpha Song",
          game: "Alpha Quest II",
          franchise: "Alpha Quest",
          composer: "Hidden Composer",
          reference_key: "C minor",
          reference_bpm: 120,
        },
        {
          id: "unrecorded",
          title: "Unrecorded Song",
          game: null,
          franchise: null,
          composer: null,
          reference_key: null,
          reference_bpm: null,
        },
      ],
      sessions: [
        {
          id: SESSION_A,
          label: "2026-05-31 Synthetic First Session",
          date: "2026-05-31",
        },
        {
          id: SESSION_B,
          label: "2026-07-26 Synthetic Second Session",
          date: "2026-07-26",
        },
        {
          id: "empty-session",
          label: "2026-08-01 Empty fixture session",
          date: "2026-08-01",
        },
      ],
      recordings: rows.map((row) => ({
        file: row.file,
        session_id: row.session_id,
        song_id: ["SYN_0001.MOV", "SYN_0004.m4a"].includes(row.file)
          ? "synthetic-alpha"
          : null,
        played_key: row.file === "SYN_0001.MOV" ? "D minor" : null,
        played_bpm: row.file === "SYN_0001.MOV" ? 108.5 : null,
      })),
      references: [
        {
          id: "alpha-cover",
          song_id: "synthetic-alpha",
          kind: "cover",
          label: "Synthetic cover arrangement",
          url: "https://www.youtube.com/watch?v=Fixture0003",
          artist: "Cover Artist",
          youtube_id: "Fixture0003",
        },
        {
          id: "alpha-original",
          song_id: "synthetic-alpha",
          kind: "original",
          label: "Synthetic original soundtrack",
          url: "https://www.youtube.com/watch?v=Fixture0001",
          artist: "Fixture Artist",
          youtube_id: "Fixture0001",
        },
        {
          id: "unrecorded-original",
          song_id: "unrecorded",
          kind: "original",
          label: "Synthetic unrecorded soundtrack",
          url: "https://www.youtube.com/watch?v=Fixture0002",
          artist: null,
          youtube_id: "Fixture0002",
        },
      ],
      repertoire: [],
    }),
  );
  await writeFile(join(directory, "thumbs", "synthetic.png"), png);
  await writeFile(join(directory, "audio", "SYN_0001.wav"), wav(6, 440));
  await writeFile(join(directory, "audio", "SYN_0002.wav"), wav(6, 550));
  await writeFile(join(directory, "audio", "SYN_0003.wav"), wav(3, 660));
  await writeFile(join(directory, "audio", "SYN_0005.wav"), wav(6, 770));
  const videoSource = await video(join(directory, "video.webm"));
  await cp("index.html", join(directory, "index.html"));
  await build({
    entryPoints: ["src/main.tsx"],
    bundle: true,
    outdir: join(directory, "assets"),
    entryNames: "app",
    format: "esm",
    target: "es2022",
    sourcemap: "inline",
    logLevel: "silent",
  });
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
    const file = join(directory, path === "/" ? "index.html" : path);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("directory");
      const body = await readFile(file);
      const headers = {
        "content-type": types[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
        "accept-ranges": "bytes",
      };
      // Media seeking needs byte ranges, like any static host provides.
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2]
          ? Math.min(Number(range[2]), body.length - 1)
          : body.length - 1;
        response.writeHead(206, {
          ...headers,
          "content-range": `bytes ${start}-${end}/${body.length}`,
          "content-length": end - start + 1,
        });
        response.end(body.subarray(start, end + 1));
        return;
      }
      response.writeHead(200, { ...headers, "content-length": body.length });
      response.end(body);
    } catch {
      response.writeHead(404).end("missing");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    youtubeApi: youtubeApi(videoSource),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
