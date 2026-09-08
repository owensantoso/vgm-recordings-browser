import { useEffect, useRef, useState } from "react";
import {
  bounds,
  driveDownload,
  formatTime,
  title,
  videoLink,
} from "./recordings";
import type { Recording } from "./recordings";

type YoutubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allow: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
};
type YoutubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady(): void;
        onStateChange(event: { data: number }): void;
        onError(): void;
      };
    },
  ) => YoutubePlayer;
};
declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let apiPromise: Promise<YoutubeApi> | undefined;
function youtubeApi() {
  if (window.YT) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YoutubeApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      apiPromise = undefined;
      reject(
        new Error(
          "YouTube took too long to respond. Try audio or open the source.",
        ),
      );
    }, 15000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      if (window.YT) resolve(window.YT);
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      window.clearTimeout(timer);
      apiPromise = undefined;
      reject(
        new Error("YouTube could not load. Try audio or open the source."),
      );
    };
    document.head.append(script);
  });
  return apiPromise;
}

export function Player({
  row,
  autoPlay,
  playRequest,
  pageLink,
  onFilter,
}: {
  row: Recording;
  autoPlay: boolean;
  playRequest: number;
  pageLink: string;
  onFilter(value: string): void;
}) {
  const range = bounds(row);
  const [mode, setMode] = useState<"video" | "audio">(
    row.has_video === "yes" ? "video" : "audio",
  );
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(range.start);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const backend = useRef<{
    play(): void;
    pause(): void;
    seek(t: number): void;
    time(): number;
  } | null>(null);
  const position = useRef(range.start);
  const wantsPlay = useRef(autoPlay);
  const fullMode = useRef(false);
  const seekUntil = useRef(0);
  const readyRef = useRef(false);
  const playingRef = useRef(false);
  const controllable =
    mode === "audio" ? Boolean(row.audio_file) : Boolean(row.youtube_video_id);
  const updatePlaying = (value: boolean) => {
    playingRef.current = value;
    wantsPlay.current = value;
    setPlaying(value);
  };

  useEffect(() => {
    let disposed = false;
    readyRef.current = false;
    setReady(false);
    setError("");
    setPlaying(false);
    playingRef.current = false;
    let dispose = () => {};
    function fail(message: string) {
      if (!disposed) {
        setError(message);
        updatePlaying(false);
      }
    }
    function loaded() {
      if (disposed) return;
      readyRef.current = true;
      setReady(true);
      backend.current?.seek(position.current);
      if (wantsPlay.current) backend.current?.play();
    }
    if (mode === "audio" && row.audio_file) {
      const audio = new Audio(`audio/${encodeURIComponent(row.audio_file)}`);
      audio.preload = "metadata";
      backend.current = {
        play: () => {
          void audio
            .play()
            .catch(() =>
              fail("Playback could not start. Press Play to try again."),
            );
        },
        pause: () => audio.pause(),
        seek: (t) => {
          audio.currentTime = t;
        },
        time: () => audio.currentTime,
      };
      audio.onloadedmetadata = loaded;
      audio.onplay = () => {
        if (!disposed) updatePlaying(true);
      };
      audio.onpause = () => {
        if (!disposed) updatePlaying(false);
      };
      audio.onended = () => {
        if (!disposed) updatePlaying(false);
      };
      audio.onerror = () =>
        fail("The audio could not load. Open the source audio below.");
      dispose = () => {
        audio.onpause = null;
        audio.onplay = null;
        audio.onended = null;
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      };
    } else if (mode === "video" && row.youtube_video_id) {
      let player: YoutubePlayer | undefined;
      void youtubeApi()
        .then((api) => {
          if (disposed || !container.current) return;
          const host = document.createElement("div");
          container.current.replaceChildren(host);
          player = new api.Player(host, {
            videoId: row.youtube_video_id,
            playerVars: {
              start: Math.floor(position.current),
              origin: window.location.origin,
              playsinline: 1,
            },
            events: {
              onReady: () => {
                if (disposed || !player) return;
                backend.current = {
                  play: () => player?.playVideo(),
                  pause: () => player?.pauseVideo(),
                  seek: (t) => player?.seekTo(t, true),
                  time: () => player?.getCurrentTime() || 0,
                };
                const iframe = container.current?.querySelector("iframe");
                if (iframe) iframe.title = `${title(row)} — YouTube video`;
                loaded();
              },
              onStateChange: (event) => {
                if (!disposed && [0, 1, 2].includes(event.data))
                  updatePlaying(event.data === 1);
              },
              onError: () =>
                fail(
                  "This video cannot play here. Try audio or open the source video.",
                ),
            },
          });
        })
        .catch((e: Error) => fail(e.message));
      dispose = () => {
        player?.destroy();
        container.current?.replaceChildren();
      };
    }
    const timer = window.setInterval(() => {
      if (
        disposed ||
        !readyRef.current ||
        !backend.current ||
        Date.now() < seekUntil.current
      )
        return;
      let next = Math.max(0, Math.min(range.full, backend.current.time()));
      const stop = fullMode.current ? range.full : range.end;
      if (playingRef.current && next >= stop - 0.1) {
        next = stop;
        backend.current.pause();
        backend.current.seek(stop);
        updatePlaying(false);
      }
      position.current = next;
      setTime(next);
    }, 100);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      dispose();
      backend.current = null;
      readyRef.current = false;
    };
  }, [mode, row]);

  useEffect(() => {
    if (!autoPlay || !playRequest) return;
    wantsPlay.current = true;
    if (readyRef.current) backend.current?.play();
  }, [playRequest, autoPlay]);

  function seek(value: number, full = false) {
    if (!readyRef.current) return;
    fullMode.current = full;
    const next = Math.max(
      full ? 0 : range.start,
      Math.min(full ? range.full : range.end, value),
    );
    position.current = next;
    setTime(next);
    seekUntil.current = Date.now() + 400;
    backend.current?.seek(next);
  }
  function toggle() {
    if (!readyRef.current) return;
    if (playingRef.current) backend.current?.pause();
    else {
      if (
        position.current >=
        (fullMode.current ? range.full : range.end) - 0.15
      )
        seek(fullMode.current ? 0 : range.start, fullMode.current);
      backend.current?.play();
    }
  }
  function switchMode(next: "video" | "audio") {
    if (mode === next) return;
    position.current = backend.current?.time() ?? position.current;
    wantsPlay.current = playingRef.current;
    setMode(next);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && expanded) {
        setExpanded(false);
        expandButton.current?.focus();
        return;
      }
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            "input, select, textarea, button, a, [contenteditable]",
          ))
      )
        return;
      if (event.key === " ") {
        event.preventDefault();
        toggle();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        seek(
          position.current + (event.key === "ArrowLeft" ? -5 : 5),
          fullMode.current,
        );
      }
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied`);
    } catch {
      setCopied("Could not copy. Select the link below to copy it manually.");
    }
  }
  const offset = Math.max(0, Math.min(range.duration, time - range.start));
  const sourceVideo = videoLink(row);
  const details = [
    ["Recorded", row.recorded_create_date],
    ["Source file", row.file],
    ["Video", `${row.size_mb} MB · ${row.resolution} · ${row.rotation}°`],
    ["Audio", `${row.audio_file} · ${row.audio_size_mb} MB`],
    ["Format", row.audio_format],
    ["Device", row.device],
  ];
  return (
    <aside
      className={`player ${expanded ? "expanded" : ""}`}
      aria-label="Selected recording"
    >
      <header className="player-heading">
        <div>
          <span className="player-status">
            {playing ? "Now playing" : "Selected take"}
          </span>
          <h2>{title(row)}</h2>
          <p className="player-game">
            {row.game_title || row.franchise || "Game not identified"}
          </p>
        </div>
        <button
          ref={expandButton}
          className="expand-control"
          aria-expanded={expanded}
          aria-controls="player-details"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Minimize" : "Expand"}
        </button>
      </header>
      <div className="transport">
        <button
          className="play-button"
          onClick={toggle}
          disabled={!ready || !controllable}
          aria-label={
            playing ? "Pause selected recording" : "Play selected recording"
          }
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="time">{formatTime(offset)}</span>
        <input
          aria-label="Seek within selected section"
          type="range"
          min="0"
          max={range.duration}
          step="0.1"
          value={offset}
          disabled={!ready || !controllable}
          onChange={(e) => seek(range.start + Number(e.target.value))}
        />
        <span className="time">{formatTime(range.duration)}</span>
      </div>
      <div className="media-switch" role="group" aria-label="Playback mode">
        <button
          aria-pressed={mode === "video"}
          disabled={row.has_video !== "yes"}
          onClick={() => switchMode("video")}
        >
          Video
        </button>
        <button
          aria-pressed={mode === "audio"}
          disabled={row.has_audio !== "yes"}
          onClick={() => switchMode("audio")}
        >
          Audio
        </button>
        <span className="mode-status" role="status">
          {error
            ? "Unavailable"
            : ready
              ? playing
                ? "Playing"
                : "Paused"
              : controllable
                ? "Loading…"
                : "Source preview"}
        </span>
      </div>
      {error && (
        <p className="playback-error" role="alert">
          {error}
        </p>
      )}
      <div id="player-details" className="player-details">
        <div className="preview">
          {mode === "video" && row.youtube_video_id ? (
            <div ref={container} className="youtube-host" />
          ) : mode === "video" && row.video_file_id ? (
            <iframe
              title={`${title(row)} — Drive preview`}
              src={`https://drive.google.com/file/d/${encodeURIComponent(row.video_file_id)}/preview`}
              allow="autoplay"
              allowFullScreen
            />
          ) : (
            <div className="audio-art">
              <img src={row.thumbnail} alt="" />
              <span>Audio recording · {row.length}</span>
            </div>
          )}
        </div>
        {(range.start > 0 || range.end < range.full) && (
          <div className="full-timeline">
            <div>
              <label htmlFor="full-seek">Full recording</label>
              <span>
                {formatTime(time)} / {formatTime(range.full)}
              </span>
            </div>
            <input
              id="full-seek"
              type="range"
              min="0"
              max={range.full}
              step="0.1"
              value={time}
              disabled={!ready || !controllable}
              onChange={(e) => seek(Number(e.target.value), true)}
            />
            <p>
              Selected section {formatTime(range.start)}–{formatTime(range.end)}
            </p>
          </div>
        )}
        <div className="performers">
          {(["drums", "piano", "guitar", "bass"] as const)
            .filter((part) => row[part])
            .map((part) => (
              <div key={part}>
                <span>{part}</span>
                <button
                  className="text-link"
                  onClick={() => onFilter(row[part])}
                >
                  {row[part]}
                </button>
              </div>
            ))}
        </div>
        <div className="source-actions">
          {sourceVideo && (
            <a href={sourceVideo} target="_blank" rel="noopener noreferrer">
              {row.youtube_video_id ? "Open YouTube" : "Open video"}
            </a>
          )}
          {row.audio_url && (
            <a href={row.audio_url} target="_blank" rel="noopener noreferrer">
              Open audio
            </a>
          )}
          {row.video_file_id && (
            <a
              href={driveDownload(row.video_file_id)}
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              Download video
            </a>
          )}
          {row.audio_file_id && (
            <a
              href={driveDownload(row.audio_file_id)}
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              Download audio
            </a>
          )}
          <button onClick={() => void copy(pageLink, "Page link")}>
            Copy page link
          </button>
          {sourceVideo && (
            <button onClick={() => void copy(sourceVideo, "Video link")}>
              Copy video link
            </button>
          )}
        </div>
        <p className="copy-status" role="status">
          {copied}
        </p>
        {copied.startsWith("Could not") && (
          <a href={pageLink}>Recording page link</a>
        )}
        <details className="metadata">
          <summary>Recording details</summary>
          <dl>
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </aside>
  );
}
