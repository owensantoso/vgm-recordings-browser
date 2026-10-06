import { useEffect, useRef, useState } from "react";
import {
  bounds,
  driveDownload,
  formatTime,
  title,
  videoLink,
} from "./recordings";
import type { Recording } from "./recordings";
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  ChevronUp,
  Copy,
  Disc3,
  Download,
  Pause,
  Play,
  Video,
  X,
  Repeat2,
} from "lucide-react";
import { PracticeControls } from "./PracticeControls";
import {
  makePracticeLink,
  parsePracticeTarget,
  validateLoopRange,
} from "./practice";
import type { LoopRange } from "./practice";
import { catalogHref } from "./Catalog";

type YoutubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allow: boolean): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration?(): number;
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
  onFilter,
  identity,
  onSong,
  onVideoVisibility,
  onPracticeTargetChange,
}: {
  row: Recording;
  autoPlay: boolean;
  playRequest: number;
  onFilter(value: string): void;
  identity: {
    title?: string;
    kind: string;
    artist: string;
    songId: string;
    musicalKey?: string | null;
    bpm?: number | null;
  };
  onSong(): void;
  onVideoVisibility(value: boolean): void;
  onPracticeTargetChange(href: string): void;
}) {
  const [sourceDuration, setSourceDuration] = useState(
    Number(row.duration_seconds) || 0,
  );
  const baseRange = bounds({
    ...row,
    duration_seconds: String(sourceDuration),
  });
  const initialHref = useRef(location.href);
  const initialTarget = useRef(
    baseRange.full > 0
      ? parsePracticeTarget(initialHref.current, row.file, baseRange.full)
      : { range: null, repeat: false, error: "" },
  );
  const [loopRange, setLoopRange] = useState<LoopRange | null>(
    initialTarget.current.range,
  );
  const [repeat, setRepeat] = useState(initialTarget.current.repeat);
  const [practiceError, setPracticeError] = useState(
    initialTarget.current.error,
  );
  const targetHandled = useRef(baseRange.full > 0);
  const range = loopRange
    ? {
        ...baseRange,
        start: loopRange.start,
        end: loopRange.end,
        duration: loopRange.end - loopRange.start,
      }
    : baseRange;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [mode, setMode] = useState<"video" | "audio">(
    row.has_audio === "yes" ? "audio" : "video",
  );
  const [expanded, setExpanded] = useState(
    Boolean(initialTarget.current.range),
  );
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat && mode === "audio";
  const [videoVisible, setVideoVisible] = useState(row.has_audio !== "yes");
  useEffect(() => {
    onVideoVisibility(mode === "video" && videoVisible);
    return () => onVideoVisibility(false);
  }, [mode, videoVisible, onVideoVisibility]);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(range.start);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [manualLink, setManualLink] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLElement>(null);
  const backend = useRef<{
    play(): void;
    pause(): void;
    seek(t: number): void;
    time(): number;
    duration(): number;
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
      const audio = new Audio(
        row.audio_path || `audio/${encodeURIComponent(row.audio_file)}`,
      );
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
        duration: () => audio.duration,
      };
      audio.onloadedmetadata = loaded;
      audio.onplay = () => {
        if (!disposed && !audio.paused) updatePlaying(true);
      };
      audio.onpause = () => {
        if (!disposed && audio.paused && !audio.ended) updatePlaying(false);
      };
      audio.onended = () => {
        if (disposed) return;
        if (repeatRef.current && wantsPlay.current && !fullMode.current) {
          const start = rangeRef.current.start;
          position.current = start;
          setTime(start);
          audio.currentTime = start;
          void audio
            .play()
            .catch(() =>
              fail("Playback could not repeat. Press Play to try again."),
            );
        } else updatePlaying(false);
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
      let cuedPosition: number | undefined;
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
                  seek: (t) => {
                    if (!player) return;
                    // YouTube seekTo starts playback from a cued/ended state.
                    // Cue the requested position when our transport is paused.
                    if (
                      !wantsPlay.current &&
                      (cuedPosition !== undefined ||
                        player.getPlayerState() !== 2)
                    ) {
                      cuedPosition = t;
                      player.cueVideoById({
                        videoId: row.youtube_video_id,
                        startSeconds: t,
                      });
                    } else player.seekTo(t, true);
                  },
                  // Cue commands settle asynchronously; the provider can report
                  // zero before Play even while its previous paused state remains.
                  time: () => cuedPosition ?? (player?.getCurrentTime() || 0),
                  duration: () => player?.getDuration?.() || 0,
                };
                const iframe = container.current?.querySelector("iframe");
                if (iframe) iframe.title = `${title(row)} — YouTube video`;
                loaded();
              },
              onStateChange: (event) => {
                if (event.data === 1) cuedPosition = undefined;
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
    let lastPaint = 0;
    const timer = window.setInterval(() => {
      if (
        disposed ||
        !readyRef.current ||
        !backend.current ||
        Date.now() < seekUntil.current
      )
        return;
      const duration = backend.current.duration();
      if (
        Number.isFinite(duration) &&
        duration > 0 &&
        !Number(row.duration_seconds) &&
        duration !== rangeRef.current.full
      )
        setSourceDuration((previous) =>
          previous === duration ? previous : duration,
        );
      const current = rangeRef.current;
      let next = Math.max(
        0,
        current.full
          ? Math.min(current.full, backend.current.time())
          : backend.current.time(),
      );
      const stop = fullMode.current ? current.full : current.end;
      const boundary =
        stop > 0 &&
        playingRef.current &&
        next >= (repeatRef.current && !fullMode.current ? stop : stop - 0.1);
      if (boundary) {
        if (repeatRef.current && !fullMode.current) {
          next = current.start;
          backend.current.seek(next);
          // The native source can end before the polling tick; seeking alone
          // does not resume an ended audio element.
          if (wantsPlay.current) backend.current.play();
        } else {
          next = stop;
          updatePlaying(false);
          backend.current.pause();
          backend.current.seek(stop);
        }
      }
      position.current = next;
      if (boundary || Date.now() - lastPaint >= 100) {
        setTime(next);
        lastPaint = Date.now();
      }
    }, 25);
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

  useEffect(() => {
    if (targetHandled.current || !baseRange.full) return;
    targetHandled.current = true;
    const target = parsePracticeTarget(
      initialHref.current,
      row.file,
      baseRange.full,
    );
    setPracticeError(target.error);
    setLoopRange(target.range);
    setRepeat(target.repeat);
    if (target.range) {
      position.current = target.range.start;
      setTime(target.range.start);
      backend.current?.seek(target.range.start);
    }
  }, [baseRange.full, row.file]);
  function writePractice(next: LoopRange, enabled: boolean) {
    const href = makePracticeLink(location.href, row.file, next, enabled);
    history.replaceState(history.state, "", href);
    onPracticeTargetChange(href);
  }
  function changeRange(next: LoopRange) {
    const message = validateLoopRange(next, baseRange.full);
    setPracticeError(message);
    if (message) return;
    setLoopRange(next);
    fullMode.current = false;
    const current = position.current;
    if (current < next.start || current >= next.end) {
      position.current = next.start;
      setTime(next.start);
      backend.current?.seek(next.start);
    }
    writePractice(next, repeat);
  }
  function changeRepeat(enabled: boolean) {
    if (mode !== "audio" || !row.audio_file || !readyRef.current || error)
      return;
    const next = { start: range.start, end: range.end };
    const message = validateLoopRange(next, baseRange.full);
    setPracticeError(message);
    if (message) return;
    setRepeat(enabled);
    repeatRef.current = enabled;
    fullMode.current = false;
    writePractice(next, enabled);
    if (
      enabled &&
      (position.current < next.start || position.current >= next.end)
    ) {
      position.current = next.start;
      setTime(next.start);
      backend.current?.seek(next.start);
    }
  }
  async function copyPractice() {
    const href = makePracticeLink(
      identity.songId
        ? catalogHref(location.href, "songs", identity.songId)
        : location.href,
      row.file,
      { start: range.start, end: range.end },
      repeat,
    );
    await copy(href, "Practice link");
  }
  function seek(value: number, full = false) {
    if (!readyRef.current) return;
    fullMode.current = full;
    if (full && repeat) {
      setRepeat(false);
      repeatRef.current = false;
      writePractice({ start: range.start, end: range.end }, false);
    }
    const next = Math.max(
      full ? 0 : range.start,
      Math.min(full ? range.full : range.end, value),
    );
    position.current = next;
    setTime(next);
    seekUntil.current = mode === "video" ? Date.now() + 400 : 0;
    backend.current?.seek(next);
  }
  function toggle() {
    if (!readyRef.current) return;
    if (mode === "video" && !playingRef.current) setVideoVisible(true);
    if (playingRef.current) {
      updatePlaying(false);
      backend.current?.pause();
    } else {
      if (
        position.current >=
        (fullMode.current ? range.full : range.end) - 0.15
      )
        seek(fullMode.current ? 0 : range.start, fullMode.current);
      backend.current?.play();
    }
  }
  function switchMode(next: "video" | "audio") {
    if (mode === next) {
      if (next === "video") setVideoVisible(true);
      return;
    }
    position.current = backend.current?.time() ?? position.current;
    setMode(next);
    setVideoVisible(next === "video");
  }
  function closeVideo() {
    if (mode === "video") {
      if (row.has_audio === "yes") switchMode("audio");
      else {
        updatePlaying(false);
        backend.current?.pause();
      }
    }
    setVideoVisible(false);
    setExpanded(false);
  }
  function collapse() {
    setExpanded(false);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
        return;
      if (
        event.key === "Escape" &&
        expanded &&
        !(
          event.target instanceof Element &&
          event.target.closest("input,textarea,[contenteditable]")
        )
      ) {
        event.preventDefault();
        collapse();
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
    setManualLink(value);
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
  const isTake = identity.kind === "our take";
  return (
    <aside
      ref={surface}
      className={`player ${expanded ? "expanded" : ""} ${mode === "video" ? "video-mode" : "audio-mode"} ${videoVisible ? "video-open" : ""}`}
      aria-label="Music player"
    >
      <header className="player-heading">
        <div>
          <span className="player-status">
            {playing ? "NOW PLAYING" : "READY TO PLAY"}
          </span>
          <button
            className="player-song"
            disabled={!identity.songId}
            onClick={onSong}
          >
            {identity.title || title(row)}
          </button>
          <p className="player-game">
            <span className="compact-source-kind">
              {isTake
                ? "Our take"
                : identity.kind === "original"
                  ? "Original soundtrack"
                  : identity.kind}{" "}
              ·{" "}
            </span>
            {row.game_title ||
              row.franchise ||
              (isTake ? "Unidentified song" : "Soundtrack reference")}
          </p>
        </div>
        <button
          ref={expandButton}
          className="expand-control icon-button"
          aria-label={expanded ? "Collapse player" : "Expand player"}
          aria-expanded={expanded}
          aria-controls="player-details"
          onClick={() => (expanded ? collapse() : setExpanded(true))}
        >
          {expanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </button>
      </header>
      <div className="player-source">
        <span className="source-badge">
          {isTake ? <AudioLines size={13} /> : <Disc3 size={13} />}{" "}
          {isTake
            ? "Our take"
            : identity.kind === "original"
              ? "Original soundtrack"
              : identity.kind}
        </span>
        <span>
          {isTake ? row.recorded_create_date?.slice(0, 10) : identity.artist}
        </span>
      </div>
      <div className="transport">
        <button
          className="play-button"
          onClick={toggle}
          disabled={!ready || !controllable}
          aria-label={
            playing ? "Pause selected recording" : "Play selected recording"
          }
        >
          {playing ? (
            <Pause size={19} fill="currentColor" />
          ) : (
            <Play size={19} fill="currentColor" />
          )}
        </button>
        <span className="time">{formatTime(offset)}</span>
        <input
          aria-label="Seek within selected section"
          type="range"
          min="0"
          max={range.duration}
          step="any"
          value={offset}
          disabled={!ready || !controllable || !range.duration}
          onChange={(e) => seek(range.start + Number(e.target.value))}
        />
        <span className="time">
          {range.duration ? formatTime(range.duration) : "—:—"}
        </span>
      </div>
      <div className="media-switch" role="group" aria-label="Playback options">
        <button
          className="repeat-quick icon-button"
          aria-label="Repeat selected excerpt"
          aria-pressed={repeat && mode === "audio"}
          title="Repeat selected excerpt"
          disabled={
            mode !== "audio" ||
            !row.audio_file ||
            !ready ||
            Boolean(error) ||
            range.duration < 0.25
          }
          onClick={() => changeRepeat(!repeat)}
        >
          <Repeat2 size={17} />
        </button>

        <button
          aria-pressed={mode === "audio"}
          disabled={row.has_audio !== "yes"}
          onClick={() => switchMode("audio")}
        >
          <AudioLines size={15} /> Audio
        </button>
        <button
          aria-pressed={mode === "video"}
          disabled={row.has_video !== "yes"}
          onClick={() => switchMode("video")}
        >
          <Video size={15} /> Video
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
      {practiceError && !expanded && (
        <p className="practice-link-error" role="alert">
          {practiceError}
        </p>
      )}
      <div id="player-details" className="player-details">
        {mode === "video" && (
          <div className="video-window-heading">
            <span>
              {identity.kind === "our take"
                ? "Our take"
                : identity.kind === "original"
                  ? "Original soundtrack"
                  : identity.kind}
            </span>
            <button
              className="icon-button"
              aria-label="Close video"
              onClick={closeVideo}
            >
              <X size={16} />
            </button>
          </div>
        )}
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
              {row.thumbnail ? (
                <img src={row.thumbnail} alt="" />
              ) : (
                <Disc3 size={70} strokeWidth={1} />
              )}
              <span>
                {isTake ? "Our rehearsal recording" : identity.artist}
              </span>
            </div>
          )}
        </div>
        <div className="player-extra">
          <PracticeControls
            duration={baseRange.full}
            currentTime={time}
            defaultRange={{ start: baseRange.start, end: baseRange.end }}
            range={{ start: range.start, end: range.end }}
            repeat={repeat && mode === "audio"}
            available={
              mode === "audio" && Boolean(row.audio_file) && ready && !error
            }
            error={practiceError}
            unavailableReason={
              error
                ? "Audio is unavailable. Open the source or choose another recording."
                : mode !== "audio" && row.audio_file
                  ? "Choose Audio to set a practice range."
                  : !ready && row.audio_file
                    ? "Waiting for audio to load."
                    : undefined
            }
            onChange={changeRange}
            onRepeat={changeRepeat}
            onCopy={() => void copyPractice()}
          />

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
                step="any"
                value={time}
                disabled={!ready || !controllable}
                onChange={(e) => seek(Number(e.target.value), true)}
              />
              <p>
                Selected section {formatTime(range.start)}–
                {formatTime(range.end)}
              </p>
            </div>
          )}
          <div className="player-musical">
            <span>
              {isTake ? "Played key" : "Reference key"}
              <strong>{identity.musicalKey || "Not recorded"}</strong>
            </span>
            <span>
              Tempo
              <strong>
                {identity.bpm ? `${identity.bpm} BPM` : "Not recorded"}
              </strong>
            </span>
          </div>
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
                <ArrowUpRight size={15} />{" "}
                {row.youtube_video_id ? "Open YouTube" : "Open video"}
              </a>
            )}
            {row.audio_url && (
              <a href={row.audio_url} target="_blank" rel="noopener noreferrer">
                <ArrowUpRight size={15} /> Open audio
              </a>
            )}
            {row.video_file_id && (
              <a
                href={driveDownload(row.video_file_id)}
                target="_blank"
                rel="noopener noreferrer"
                download
              >
                <Download size={15} /> Video
              </a>
            )}
            {row.audio_file_id && (
              <a
                href={driveDownload(row.audio_file_id)}
                target="_blank"
                rel="noopener noreferrer"
                download
              >
                <Download size={15} /> Audio
              </a>
            )}
            <button onClick={() => void copy(location.href, "Page link")}>
              <Copy size={14} /> Page link
            </button>
          </div>
          <p className="copy-status" role="status">
            {copied}
          </p>
          {copied.startsWith("Could not") && (
            <a className="manual-copy-link" href={manualLink}>
              Open or copy this link
            </a>
          )}
          {isTake && (
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
          )}
        </div>
      </div>
    </aside>
  );
}
