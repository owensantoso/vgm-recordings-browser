import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JamRecorder } from "./JamRecorder";
import type { Jam, JamBackingMix } from "./jamData";
import { PracticeWorkspace } from "./PracticeWorkspace";
import { nextPlaybackRate, SpeedControl } from "./SpeedControl";
import { loadChunkedStemPlayback } from "./ChunkedStemPlaybackEngine";
import type { ChunkedStemPlaybackEngine } from "./ChunkedStemPlaybackEngine";
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
  Download,
  Pause,
  Square,
  Play,
  Video,
  X,
} from "lucide-react";
import type { StemMixValue } from "./StemMixer";
import { fetchPracticeSource } from "./practiceData";
import type { PracticeSource, PracticeSection } from "./practiceData";
import { loadStemPlayback } from "./StemPlaybackEngine";
import type { StemPlaybackEngine } from "./StemPlaybackEngine";
import {
  makePracticeLink,
  makeSectionLink,
  parsePracticeTarget,
  validateLoopRange,
} from "./practice";
import type { LoopRange, PracticeTarget } from "./practice";
import { catalogHref } from "./Catalog";

type YoutubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allow: boolean): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration?(): number;
  setPlaybackRate?(rate: number): void;
  getPlaybackRate?(): number;
  getAvailablePlaybackRates?(): number[];
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
        onPlaybackRateChange?(event: { data: number }): void;
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
  preferredMode,
  playbackRate = 1,
  changedRate = 1,
  onRateChange = () => {},
  identity,
  onSong,
  onVideoVisibility,
  onPlayingChange,
  jamToReplay, jamReplayRequest, jamReplayStart, commentSeek, onJamSaved, onJamCaptureBusy,
  onPracticeTargetChange,
  practiceHost,
}: {
  row: Recording;
  practiceHost: HTMLElement | null;
  autoPlay: boolean;
  playRequest: number;
  preferredMode?: "audio" | "video";
  playbackRate?: number;
  changedRate?: number;
  onRateChange?(rate: number): void;
  identity: {
    title?: string;
    kind: string;
    referenceLabel?: string;
    artist: string;
    songId: string;
    musicalKey?: string | null;
    bpm?: number | null;
  };
  onSong(): void;
  onVideoVisibility(value: boolean): void;
  onPlayingChange?(value: boolean): void;
  jamToReplay?: Jam | null;
  jamReplayRequest?: number;
  jamReplayStart?: number;
  commentSeek?: { request: number; seconds: number };
  onJamSaved?(jam: Jam): void;
  onJamCaptureBusy?(busy: boolean): void;
  onPracticeTargetChange(href: string): void;
}) {
  const [jamLocked, setJamLocked] = useState(false);
  const [jamMixAudition, setJamMixAudition] = useState(false);
  const jamMixAuditionRef = useRef(false);
  const jamContinuityError = useRef("");
  const jamNativeStart = useRef(0);
  const [stemReload, setStemReload] = useState(0);
  const jamLockRef = useRef(false), jamStop = useRef<(() => void) | null>(null);
  const modeRef = useRef<"audio" | "stems" | "video">("audio");
  const [sourceDuration, setSourceDuration] = useState(
    Number(row.duration_seconds) || 0,
  );
  const baseRange = bounds({
    ...row,
    duration_seconds: String(sourceDuration),
  });
  const initialHref = useRef(location.href);
  const linkedSection = useRef(new URL(initialHref.current).searchParams.has("section"));
  const initialTarget = useRef<PracticeTarget>(
    baseRange.full > 0 && !linkedSection.current
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
  const targetHandled = useRef(baseRange.full > 0 && !linkedSection.current);
  const [practiceData, setPracticeData] = useState<PracticeSource | null>(null);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState("");
  const [sectionsReload, setSectionsReload] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState("");
  const activeSectionRef = useRef(activeSectionId);
  activeSectionRef.current = activeSectionId;
  const [stemMix, setStemMix] = useState<Record<string, StemMixValue>>({});
  const stemMixRef = useRef(stemMix);
  stemMixRef.current = stemMix;
  const stemEngine = useRef<StemPlaybackEngine | ChunkedStemPlaybackEngine | null>(null);
  const initialAudioSelection = useRef(row.file.startsWith("ref:") && row.has_audio === "yes");
  const [audioRoutingPending, setAudioRoutingPending] = useState(initialAudioSelection.current);
  const [buffering, setBuffering] = useState(false);
  const [originalPreferred, setOriginalPreferred] = useState(false);
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
  const [mode, setMode] = useState<"video" | "audio" | "stems">(
    preferredMode || (row.has_audio === "yes" ? "audio" : "video"),
  );
  modeRef.current = mode;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat && mode !== "video";
  const stableStemSet = useRef(practiceData?.stemSet ?? null);
  const incomingStemSet = practiceData?.stemSet ?? null;
  if (JSON.stringify(stableStemSet.current) !== JSON.stringify(incomingStemSet)) stableStemSet.current = incomingStemSet;
  const stemSet = stableStemSet.current;
  const providerStemSet = mode === "stems" ? stemSet : null;
  const covered = (next: LoopRange) => Boolean(stemSet && next.start >= stemSet.start && next.end <= stemSet.end);
  const stemRangeValid = mode !== "stems" || covered(range);
  const resolvingSection = linkedSection.current && !targetHandled.current && !sectionsError;
  const [videoVisible, setVideoVisible] = useState(preferredMode === "video" || row.has_audio !== "yes");
  const rateRef = useRef(playbackRate);
  rateRef.current = playbackRate;
  const [videoRate, setVideoRate] = useState(1);
  const lastVideoRate = useRef(1);
  const [videoRates, setVideoRates] = useState<number[]>([1]);
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
  const backend = useRef<{
    play(): void;
    pause(): void;
    seek(t: number): void;
    time(): number;
    duration(): number;
    setRate?(rate: number): void;
  } | null>(null);
  const position = useRef(range.start);
  const wantsPlay = useRef(autoPlay && !linkedSection.current);
  useEffect(() => {
    onPlayingChange?.(playing || (buffering && wantsPlay.current));
  }, [playing, buffering, onPlayingChange]);
  const fullMode = useRef(false);
  const seekUntil = useRef(0);
  const readyRef = useRef(false);
  const playingRef = useRef(false);
  const controllable =
    mode === "stems" ? Boolean(stemSet) && stemRangeValid : mode === "audio" ? Boolean(row.audio_file) : Boolean(row.youtube_video_id);
  const updatePlaying = (value: boolean) => {
    playingRef.current = value;
    wantsPlay.current = value;
    setPlaying(value);
  };

  useEffect(() => {
    if (!row.file.startsWith("ref:") || row.has_audio !== "yes") {
      if (linkedSection.current && !targetHandled.current) setSectionsError("Sections are unavailable for this source. Choose an audio range instead.");
      return;
    }
    let disposed = false;
    setSectionsLoading(true);
    setSectionsError("");
    void fetchPracticeSource(row.file).then(data => {
      if (disposed) return;
      if (data.sourceId !== row.file || !Number.isFinite(data.duration) || data.duration <= 0 ||
          (data.stemSet && (data.stemSet.sourceId !== row.file || data.stemSet.sourceHash !== data.sourceHash))) {
        throw new Error("Practice data does not match this source. Reload sections.");
      }
      setPracticeData(previous => previous?.stemSet && data.stemSet && JSON.stringify(previous.stemSet) === JSON.stringify(data.stemSet)
        ? { ...data, stemSet: previous.stemSet } : data);
      // Container metadata can round just past the last PCM frame. Use the
      // verified full-set endpoint when both durations identify that same frame.
      const fullStem = data.stemSet?.coverage === "full-source" ? data.stemSet : null;
      const sameEndFrame = fullStem && fullStem.start === 0 &&
        Number.isSafeInteger(fullStem.sampleRate) && fullStem.sampleRate > 0 &&
        Number.isSafeInteger(fullStem.frames) && fullStem.frames > 0 &&
        Math.round(data.duration * fullStem.sampleRate) === fullStem.frames &&
        Math.round(fullStem.end * fullStem.sampleRate) === fullStem.frames;
      setSourceDuration(sameEndFrame ? fullStem.end : data.duration);
    }).catch(failure => {
      if (!disposed) setSectionsError(failure instanceof Error ? failure.message : "Sections are unavailable.");
    }).finally(() => { if (!disposed) setSectionsLoading(false); });
    return () => { disposed = true; };
  }, [row.file, row.has_audio, sectionsReload]);

  useEffect(() => {
    if (!initialAudioSelection.current || (!practiceData && !sectionsError)) return;
    if (linkedSection.current && !targetHandled.current && !sectionsError) return;
    initialAudioSelection.current = false;
    setAudioRoutingPending(false);
    const selectedSet = practiceData?.stemSet;
    if (!originalPreferred && mode === "audio" && selectedSet && (selectedSet.coverage === "full-source" || (rangeRef.current.start >= selectedSet.start && rangeRef.current.end <= selectedSet.end))) {
      const resume = wantsPlay.current;
      // Before native metadata arrives, its clock is still zero. Keep the
      // requested practice position until that backend has actually sought.
      position.current = readyRef.current ? (backend.current?.time() ?? position.current) : position.current;
      backend.current?.pause();
      playingRef.current = false; setPlaying(false);
      wantsPlay.current = resume;
      setMode("stems");
    } else if (wantsPlay.current && readyRef.current && !linkedSection.current) backend.current?.play();
  }, [practiceData, sectionsError, originalPreferred, mode, range.start, range.end, activeSectionId]);

  useEffect(() => {
    let disposed = false;
    readyRef.current = false;
    setReady(false);
    setError("");
    setPlaying(false);
    setBuffering(false);
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
      backend.current?.setRate?.(rateRef.current);
      if (wantsPlay.current && !initialAudioSelection.current) backend.current?.play();
    }
    if (mode === "stems") {
      const controller = new AbortController();
      let engine: StemPlaybackEngine | ChunkedStemPlaybackEngine | null = null;
      let unsubscribe = () => {};
      let playEpoch = 0;
      dispose = () => {
        ++playEpoch;
        unsubscribe();
        controller.abort();
        if (stemEngine.current === engine) stemEngine.current = null;
        if (engine) void engine.destroy().catch(() => {});
      };
      if (!providerStemSet) fail("Stem preview is unavailable. Choose Audio for the full mix.");
      else void (providerStemSet.chunks?.length ? loadChunkedStemPlayback(providerStemSet, controller.signal) : loadStemPlayback(providerStemSet, controller.signal)).then(async loadedEngine => {
        if (disposed) { void loadedEngine.destroy().catch(() => {}); return; }
        engine = loadedEngine;
        stemEngine.current = engine;
        if ("subscribe" in engine) unsubscribe = engine.subscribe(snapshot => {
          if (disposed) return;
          setBuffering(snapshot.buffering);
          playingRef.current = snapshot.playing;
          setPlaying(snapshot.playing);
          if (snapshot.state === "error") fail(snapshot.error || "Instrument audio could not load. Choose Original mix.");
          if (snapshot.state === "ended") updatePlaying(false);
        });
        for (const [id, value] of Object.entries(stemMixRef.current)) {
          if (providerStemSet.tracks.some(track => track.id === id)) engine.setMix(id, value);
        }
        engine.setLoop(repeatRef.current ? { start: rangeRef.current.start, end: rangeRef.current.end } : null);
        backend.current = {
          play: () => {
            const request = ++playEpoch;
            wantsPlay.current = true;
            void engine!.play().then(() => {
              if (!disposed && request === playEpoch && wantsPlay.current && !("subscribe" in engine!)) updatePlaying(true);
            }).catch(failure => {
              if (!disposed && request === playEpoch && wantsPlay.current) fail(failure instanceof Error ? failure.message : "Stems could not start.");
            });
          },
          pause: () => { ++playEpoch; engine!.pause(); },
          seek: value => {
            const request = ++playEpoch;
            try { void Promise.resolve(engine!.seek(value)).catch(failure => {
              if (!disposed && request === playEpoch) fail(failure instanceof Error ? failure.message : "The audio could not seek.");
            }); }
            catch (failure) { fail(failure instanceof Error ? failure.message : "The audio could not seek."); }
          },
          time: () => engine!.time(),
          duration: () => rangeRef.current.full,
          setRate: rate => {
            if (rate === engine!.getRate()) return;
            const request = ++playEpoch;
            void engine!.setRate(rate).catch(failure => {
              if (!disposed && request === playEpoch) fail(failure instanceof Error ? failure.message : "Speed could not change.");
            });
          },
        };
        await engine.setRate(rateRef.current);
        await engine.seek(position.current);
        if (disposed) return;
        readyRef.current = true;
        setReady(true);
        if (wantsPlay.current) backend.current.play();
      }).catch(failure => {
        if (!disposed) {
          if (engine) { void engine.destroy().catch(() => {}); if (stemEngine.current === engine) stemEngine.current = null; }
          backend.current = null;
          fail(failure instanceof Error ? failure.message : "Stems could not load.");
        }
      });
    } else if (mode === "audio" && row.audio_file) {
      const audio = new Audio(
        row.audio_path || `audio/${encodeURIComponent(row.audio_file)}`,
      );
      audio.preload = "metadata";
      audio.preservesPitch = true;
      audio.playbackRate = rateRef.current;
      let playEpoch = 0;
      function playAudio(message: string) {
        const request = ++playEpoch;
        wantsPlay.current = true;
        void audio.play().catch(() => {
          if (!disposed && request === playEpoch && wantsPlay.current) fail(message);
        });
      }
      backend.current = {
        play: () => playAudio("Playback could not start. Press Play to try again."),
        pause: () => { ++playEpoch; audio.pause(); },
        seek: (t) => {
          audio.currentTime = t;
        },
        time: () => audio.currentTime,
        duration: () => audio.duration,
        setRate: rate => { audio.preservesPitch = true; audio.playbackRate = rate; },
      };
      audio.onloadedmetadata = loaded;
      audio.onwaiting = audio.onstalled = () => { if (!disposed && jamLockRef.current && playingRef.current && audio.currentTime > jamNativeStart.current + .005) jamContinuityError.current = "Backing continuity was interrupted."; };
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
          playAudio("Playback could not repeat. Press Play to try again.");
        } else updatePlaying(false);
      };
      audio.onerror = () =>
        fail("The audio could not load. Open the source audio below.");
      dispose = () => {
        ++playEpoch;
        audio.onwaiting = audio.onstalled = null;
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
                const rates = player.getAvailablePlaybackRates?.().filter(rate => rate >= .5 && rate <= 2) || [1];
                setVideoRates(rates.length ? rates : [1]);
                setVideoRate(player.getPlaybackRate?.() || 1);
                function setVideoSpeed(rate: number) {
                  if (!player) return;
                  const supported = player.getAvailablePlaybackRates?.().filter(value => value >= .5 && value <= 2) || [1];
                  const nearest = supported.reduce((best, value) => Math.abs(value - rate) < Math.abs(best - rate) ? value : best, supported[0] || 1);
                  player.setPlaybackRate?.(nearest);
                }
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
                  setRate: setVideoSpeed,
                };
                const iframe = container.current?.querySelector("iframe");
                if (iframe) iframe.title = `${title(row)} — YouTube video`;
                loaded();
              },
              onStateChange: (event) => {
                if (event.data === 1) cuedPosition = undefined;
                if (!disposed && event.data === 5) backend.current?.setRate?.(rateRef.current);
                if (!disposed && [0, 1, 2].includes(event.data))
                  updatePlaying(event.data === 1);
              },
              onPlaybackRateChange: event => {
                if (!disposed && Number.isFinite(event.data) && event.data > 0) {
                  setVideoRate(event.data);
                  if (event.data !== 1) lastVideoRate.current = event.data;
                }
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
        (mode === "stems" && (!providerStemSet || rangeRef.current.start < providerStemSet.start || rangeRef.current.end > providerStemSet.end)) ||
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
        !(mode === "stems" && repeatRef.current) &&
        next >= (mode === "stems" || (repeatRef.current && !fullMode.current) ? stop : stop - 0.1);
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
  }, [mode, row, providerStemSet, stemReload]);

  useEffect(() => {
    if (!autoPlay || !playRequest || initialAudioSelection.current || (linkedSection.current && !targetHandled.current)) return;
    if (preferredMode && preferredMode !== mode) {
      position.current = backend.current?.time() ?? position.current;
      backend.current?.pause();
      wantsPlay.current = true;
      setMode(preferredMode);
      setVideoVisible(preferredMode === "video");
      return;
    }
    wantsPlay.current = true;
    if (mode === "video") setVideoVisible(true);
    if (readyRef.current) backend.current?.play();
  }, [playRequest, autoPlay]);

  useEffect(() => {
    if (readyRef.current) backend.current?.setRate?.(playbackRate);
  }, [playbackRate, ready, mode]);

  useEffect(() => {
    if (targetHandled.current || !baseRange.full || (linkedSection.current && !practiceData)) return;
    targetHandled.current = true;
    const target = parsePracticeTarget(
      initialHref.current,
      row.file,
      baseRange.full,
      practiceData?.sections,
    );
    setPracticeError(target.error);
    setLoopRange(target.range);
    setRepeat(target.repeat);
    setActiveSectionId(target.sectionId || "");
    if (target.range) {
      updatePlaying(false);
      backend.current?.pause();
      position.current = target.range.start;
      setTime(target.range.start);
      backend.current?.seek(target.range.start);
    }
  }, [baseRange.full, row.file, practiceData]);

  useEffect(() => {
    if (mode !== "stems" || !stemEngine.current || !stemRangeValid) return;
    stemEngine.current.setLoop(repeat ? { start: range.start, end: range.end } : null);
  }, [mode, repeat, range.start, range.end, stemRangeValid]);

  function writePractice(next: LoopRange, enabled: boolean, sectionId = activeSectionRef.current) {
    targetHandled.current = true;
    const href = sectionId ? makeSectionLink(location.href, row.file, sectionId, enabled) : makePracticeLink(location.href, row.file, next, enabled);
    history.replaceState(history.state, "", href);
    onPracticeTargetChange(href);
  }
  function changeRange(next: LoopRange) {
    if (jamLockRef.current) return;
    const message = validateLoopRange(next, baseRange.full);
    setPracticeError(message);
    if (message) return;
    if (mode === "stems" && !covered(next)) { setPracticeError("This range is outside the stem preview. Choose Audio for the full mix."); return; }
    targetHandled.current = true;
    activeSectionRef.current = "";
    setActiveSectionId("");
    setLoopRange(next);
    rangeRef.current = { ...baseRange, ...next, duration: next.end - next.start };
    fullMode.current = false;
    if (mode === "stems") stemEngine.current?.setLoop(repeat ? next : null);
    const current = position.current;
    if (current < next.start || current >= next.end) {
      position.current = next.start;
      setTime(next.start);
      backend.current?.seek(next.start);
    }
    writePractice(next, repeat, "");
  }
  function changeRepeat(enabled: boolean) {
    if (jamLockRef.current) return;
    if (mode === "video" || !row.audio_file || !readyRef.current || error || !stemRangeValid || resolvingSection)
      return;
    const next = { start: range.start, end: range.end };
    const message = validateLoopRange(next, baseRange.full);
    setPracticeError(message);
    if (message) return;
    setRepeat(enabled);
    repeatRef.current = enabled;
    fullMode.current = false;
    if (mode === "stems") stemEngine.current?.setLoop(enabled ? next : null);
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
    const context = identity.songId ? catalogHref(location.href, "songs", identity.songId) : location.href;
    const href = activeSectionRef.current ? makeSectionLink(context, row.file, activeSectionRef.current, repeat) : makePracticeLink(
      context,
      row.file,
      { start: range.start, end: range.end },
      repeat,
    );
    return copy(href, "Practice link");
  }
  function seek(value: number, full = false) {
    if (jamLockRef.current) return;
    if (!readyRef.current || resolvingSection) return;
    if (mode === "stems" && (!stemSet || !Number.isFinite(value) || value < stemSet.start || value > stemSet.end)) {
      setPracticeError("Stems cover the disclosed preview only. Choose Audio to seek through the full recording."); return;
    }
    fullMode.current = full;
    if (full && repeat) {
      setRepeat(false);
      repeatRef.current = false;
      if (mode === "stems") stemEngine.current?.setLoop(null);
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
    if (jamLockRef.current) { jamStop.current?.(); return; }
    if (!readyRef.current || initialAudioSelection.current || resolvingSection || !stemRangeValid) return;
    if (mode === "video" && !playingRef.current) setVideoVisible(true);
    if (playingRef.current || wantsPlay.current) {
      updatePlaying(false);
      backend.current?.pause();
    } else {
      if (
        position.current >=
        (fullMode.current ? range.full : range.end) - 0.15
      )
        seek(fullMode.current ? 0 : range.start, fullMode.current);
      wantsPlay.current = true;
      backend.current?.play();
    }
  }
  function switchMode(next: "video" | "audio" | "stems") {
    if (jamLockRef.current) return;
    if (mode === next) {
      if (next === "video") setVideoVisible(true);
      return;
    }
    if (next === "stems" && (!stemSet || (activeSectionRef.current && !covered(range)))) {
      setPracticeError("This section is outside the stem preview. Choose Audio for the full mix."); return;
    }
    const current = stemRangeValid ? (backend.current?.time() ?? position.current) : position.current;
    const resume = wantsPlay.current && mode !== "stems" && next !== "stems";
    backend.current?.pause();
    updatePlaying(false);
    wantsPlay.current = resume;
    position.current = current;
    seekUntil.current = 0;
    if (next === "stems" && stemSet) {
      targetHandled.current = true;
      fullMode.current = false;
      if (!covered(range)) {
        const preview = { start: stemSet.start, end: stemSet.end };
        setLoopRange(preview);
        rangeRef.current = { ...baseRange, ...preview, duration: preview.end - preview.start };
        activeSectionRef.current = ""; setActiveSectionId("");
        writePractice(preview, repeat, "");
      }
      if (position.current < rangeRef.current.start || position.current >= rangeRef.current.end) position.current = rangeRef.current.start;
    }
    setTime(position.current);
    setPracticeError("");
    setMode(next);
    setVideoVisible(next === "video");
  }

  function selectSection(section: PracticeSection, play = true) {
    if (jamLockRef.current) return;
    const next = { start: section.start, end: section.end };
    const message = validateLoopRange(next, baseRange.full);
    if (message || (mode === "stems" && !covered(next))) {
      updatePlaying(false); backend.current?.pause();
      setPracticeError(message || "This section is outside the stem preview. Choose Audio for the full mix."); return;
    }
    updatePlaying(false); backend.current?.pause();
    targetHandled.current = true;
    activeSectionRef.current = section.id; setActiveSectionId(section.id);
    setPracticeError(""); setLoopRange(next);
    rangeRef.current = { ...baseRange, ...next, duration: next.end - next.start };
    fullMode.current = false; seekUntil.current = 0; position.current = next.start; setTime(next.start);
    writePractice(next, repeat, section.id);
    wantsPlay.current = play;
    if (mode === "video") { wantsPlay.current = play; setMode("audio"); setVideoVisible(false); }
    else {
      if (mode === "stems") stemEngine.current?.setLoop(repeat ? next : null);
      backend.current?.seek(next.start);
      if (play && readyRef.current) backend.current?.play();
    }
  }
  function savedSection(section: PracticeSection) {
    const previous = practiceData?.sections.find(value => value.id === section.id);
    setPracticeData(data => data ? { ...data, sections: previous ? data.sections.map(value => value.id === section.id ? section : value) : [...data.sections, section] } : data);
    if (activeSectionRef.current !== section.id || (previous?.start === section.start && previous.end === section.end)) return;
    if (mode === "stems" && !covered(section)) {
      updatePlaying(false); backend.current?.pause();
      const next = { start: section.start, end: section.end };
      setLoopRange(next); rangeRef.current = { ...baseRange, ...next, duration: next.end - next.start };
      position.current = next.start; setTime(next.start);
      setPracticeError("The saved section is outside the stem preview. Choose Audio for the full mix.");
      return;
    }
    selectSection(section, false);
  }
  function changeMix(id: string, value: StemMixValue) {
    if (jamLockRef.current && !jamMixAuditionRef.current) return;
    stemEngine.current?.setMix(id, value);
    setStemMix(current => ({ ...current, [id]: value }));
  }
  function closeVideo() {
    if (mode === "video") {
      if (row.has_audio === "yes") chooseAudio(originalPreferred);
      else {
        updatePlaying(false);
        backend.current?.pause();
      }
    }
    setVideoVisible(false);
  }
  const spacePauseKey = useRef(false);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
        return;
      if (
        event.key === "Escape" &&
        mode === "video" && videoVisible &&
        !(
          event.target instanceof Element &&
          event.target.closest("input,textarea,[contenteditable]")
        )
      ) {
        event.preventDefault();
        closeVideo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof Element && event.target.closest('input:not([type="range"]),select,textarea,[contenteditable],video,audio,iframe'))) return;
      if (event.key === " " && spacePauseKey.current) { event.preventDefault(); return; }
      if (event.key === " ") {
        event.preventDefault(); spacePauseKey.current = true; toggle(); return;
      }
      if (["[", "]", "\\"].includes(event.key)) {
        event.preventDefault();
        event.key === "\\" ? toggleSpeed() : stepSpeed(event.key === "]" ? 1 : -1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        seekTimeline(position.current + (event.key === "ArrowLeft" ? -5 : 5));
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.key === " " && spacePauseKey.current) { event.preventDefault(); spacePauseKey.current = false; }
    }
    function blur() { spacePauseKey.current = false; }
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); };
  });
  async function copy(value: string, label: string) {
    setManualLink(value);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied`);
      return true;
    } catch {
      setCopied("Could not copy. Select the link below to copy it manually.");
      return false;
    }
  }
  const sourceVideo = videoLink(row);
  const isTake = identity.kind === "our take";
  const audioDownload = row.audio_file_id ? driveDownload(row.audio_file_id) : row.audio_file ? row.audio_path || `audio/${encodeURIComponent(row.audio_file)}` : "";
  const videoDownload = row.video_file_id ? driveDownload(row.video_file_id) : "";
  const available = ready && !error && !audioRoutingPending && !resolvingSection && stemRangeValid;
  function chooseAudio(original = false) {
    if (jamLockRef.current) return;
    initialAudioSelection.current = false; setAudioRoutingPending(false);
    setOriginalPreferred(original);
    switchMode(!original && stemSet ? "stems" : "audio");
  }
  const displayedRate = mode === "video" ? videoRate : playbackRate;
  function applySpeed(rate: number) {
    if (jamLockRef.current) return;
    // Provider controls can change the confirmed speed without changing our
    // preference. A repeated preference must still command the video backend.
    if (mode === "video") backend.current?.setRate?.(rate);
    onRateChange(rate);
  }
  function stepSpeed(direction: number) {
    if (!readyRef.current || !controllable || error) return;
    applySpeed(nextPlaybackRate(displayedRate, direction, mode === "video" ? videoRates : undefined));
  }
  function toggleSpeed() {
    if (!readyRef.current || !controllable || error) return;
    const remembered = mode === "video" && videoRates.includes(lastVideoRate.current) && lastVideoRate.current !== 1 ? lastVideoRate.current : changedRate;
    applySpeed(displayedRate === 1 ? remembered : 1);
  }
  function seekTimeline(seconds: number) {
    const next = Math.max(0, Math.min(baseRange.full, seconds));
    seek(next, !(repeat && next >= range.start && next < range.end));
  }
  useEffect(() => {
    if (!commentSeek || jamLockRef.current || !ready) return;
    updatePlaying(false); backend.current?.pause(); seekTimeline(commentSeek.seconds);
  }, [commentSeek?.request, ready]);
  const pauseForJam = () => { updatePlaying(false); backend.current?.pause(); };
  async function prepareJamCapture() {
    jamContinuityError.current = "";
    if (!readyRef.current || modeRef.current === "video") throw new Error("Prepare local Audio before recording a jam.");
    const set = stemSet;
    if (modeRef.current === "stems" && set) {
      const groupFrames = set.chunks ? Math.max(...set.chunks.map(chunk => chunk.frameCount)) * 3 : set.frames;
      const decodeBudget = groupFrames * set.channels * 4 * set.tracks.length + 120.5 * 48000 * 2 * 4;
      if (decodeBudget > 300 * 1024 * 1024) throw new Error("This stem set leaves insufficient memory for mic capture. Choose Original mix.");
    }
    const captureStart = loopRange ? rangeRef.current.start : Math.max(rangeRef.current.start, Math.min(rangeRef.current.end, backend.current?.time() ?? position.current));
    pauseForJam(); setRepeat(false); repeatRef.current = false; fullMode.current = false;
    stemEngine.current?.setLoop(null);
    jamNativeStart.current = captureStart; position.current = captureStart; setTime(position.current);
    if (stemEngine.current && modeRef.current === "stems") await stemEngine.current.seek(position.current);
    else backend.current?.seek(position.current);
    return { start: captureStart, end: rangeRef.current.end };
  }
  async function suspendBackingForMicDecode(): Promise<() => void> {
    pauseForJam();
    if (modeRef.current !== "stems" || !stemEngine.current) return () => {};
    const engine = stemEngine.current;
    readyRef.current = false; setReady(false); backend.current = null; stemEngine.current = null;
    await engine.destroy();
    return () => setStemReload(value => value + 1);
  }
  async function prepareJamReplay(mix: JamBackingMix, at: number) {
    jamContinuityError.current = "";
    const sourceId = mix.source.recording.kind === "reference" ? `ref:${mix.source.recording.id}` : mix.source.recording.id;
    if (sourceId !== row.file || !practiceData || mix.source.sha256 !== practiceData.sourceHash) throw new Error("Open the jam's exact backing recording first. Mic only remains available.");
    if (mix.mode === "stems" && (!stemSet || !mix.stems || stemSet.id !== mix.stems.setId || stemSet.tracks.some(track => mix.stems?.tracks.find(value => value.id === track.id)?.assetHash !== track.sha256))) throw new Error("The captured stem revision is unavailable. Mic only remains available.");
    pauseForJam(); setRepeat(false); repeatRef.current = false; fullMode.current = true;
    const desired = mix.mode === "stems" ? "stems" : "audio";
    setLoopRange(null); rangeRef.current = baseRange;
    const capturedMix = Object.fromEntries((mix.stems?.tracks || []).map(track => [track.id, { level: track.level, muted: track.muted, solo: track.solo }]));
    stemMixRef.current = capturedMix; setStemMix(capturedMix);
    rateRef.current = mix.playbackRate; onRateChange(mix.playbackRate);
    jamNativeStart.current = at; position.current = at; setTime(at);
    if (modeRef.current !== desired) { readyRef.current = false; setMode(desired); }
    const deadline = performance.now() + 20000;
    while (!readyRef.current || modeRef.current !== desired) {
      if (!jamLockRef.current) throw new Error("Jam replay cancelled.");
      if (performance.now() > deadline) throw new Error("The captured backing could not prepare. Mic only remains available.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (desired === "stems" && stemEngine.current) {
      stemEngine.current.setLoop(null);
      for (const [id, value] of Object.entries(capturedMix)) stemEngine.current.setMix(id, value);
      await stemEngine.current.setRate(mix.playbackRate); await stemEngine.current.seek(at);
    } else { backend.current?.setRate?.(mix.playbackRate); backend.current?.seek(at); }
  }
  const workspace = <PracticeWorkspace
    data={practiceData} loading={sectionsLoading} error={sectionsError}
    time={time} duration={baseRange.full} range={{ start: range.start, end: range.end }}
    defaultRange={{ start: baseRange.start, end: baseRange.end }} repeat={repeat && mode !== "video"}
    activeSectionId={activeSectionId} available={available && mode !== "video" && !jamLocked}
    stemsActive={mode === "stems"} mix={stemMix} mixAvailable={available && mode !== "video" && (!jamLocked || jamMixAudition)}
    notice={buffering ? "Buffering instruments…" : mode === "stems" && stemSet?.coverage === "excerpt" ? `Instrument preview · original ${formatTime(stemSet.start)}–${formatTime(stemSet.end)}` : ""}
    practiceError={practiceError} onSeek={seekTimeline} onRange={changeRange} onRepeat={changeRepeat}
    onCopy={copyPractice} onSection={section => selectSection(section)}
    onCopySection={section => void copy(makeSectionLink(identity.songId ? catalogHref(location.href, "songs", identity.songId) : location.href, row.file, section.id, repeat), "Section link")}
    onSavedSection={savedSection}
    onCopyAnnotation={annotation => void copy(makePracticeLink(identity.songId ? catalogHref(location.href, "songs", identity.songId) : location.href, row.file, { start: annotation.start, end: annotation.end }, false), "Annotation link")}
    onSavedAnnotation={annotation => setPracticeData(data => data ? { ...data, annotations: (data.annotations || []).some(item => item.id === annotation.id) ? data.annotations.map(item => item.id === annotation.id ? annotation : item) : [...(data.annotations || []), annotation] } : data)}
    onReload={() => setSectionsReload(value => value + 1)} onMix={changeMix}
    onOriginal={() => chooseAudio(true)} onInstrumentMix={() => chooseAudio(false)}
  />;
  return <>
    <JamRecorder host={practiceHost} songId={identity.songId}
      recording={row.file.startsWith("ref:") ? { kind: "reference", id: row.file.slice(4) } : { kind: "archive", id: row.file }}
      sourceMode={mode} ready={available} activeSectionId={activeSectionId} rate={playbackRate}
      mix={stemMix}
      getClock={() => ({ time: backend.current?.time() ?? position.current, playing: playingRef.current, buffering: stemEngine.current && "getStatus" in stemEngine.current ? stemEngine.current.getStatus().buffering : buffering, error: error || jamContinuityError.current, end: rangeRef.current.end, rate: rateRef.current })}
      prepareCapture={prepareJamCapture} suspendBackingForDecode={suspendBackingForMicDecode} prepareReplay={prepareJamReplay} pauseBacking={pauseForJam} playBacking={() => backend.current?.play()}
      onMixAudition={value => { jamMixAuditionRef.current = value; setJamMixAudition(value); }}
      onLocked={value => { jamLockRef.current = value; setJamLocked(value); onJamCaptureBusy?.(value); }} registerStop={stop => { jamStop.current = stop; }}
      jamToReplay={jamToReplay} jamReplayRequest={jamReplayRequest} jamReplayStart={jamReplayStart} onJamSaved={onJamSaved} />
    <aside className={`player compact-player ${mode === "video" ? "video-mode" : "audio-mode"} ${mode === "stems" ? "stem-mode" : ""} ${videoVisible ? "video-open" : ""}`} aria-label="Music player">
      <header className="player-heading"><div><span className="player-status">{buffering ? "BUFFERING" : playing ? "NOW PLAYING" : "READY TO PLAY"}</span><button className="player-song" disabled={!identity.songId} onClick={onSong}>{identity.title || title(row)}</button><p className="player-game" title={identity.referenceLabel}>{isTake ? "Our take" : identity.referenceLabel || (identity.kind === "original" ? "Original soundtrack" : identity.kind)}{!identity.referenceLabel && identity.artist ? ` · ${identity.artist}` : ""}</p></div></header>
      <div className="transport"><button className="play-button" onClick={toggle} disabled={!jamLocked && (!available || !controllable)} aria-label={jamLocked ? "Stop jam" : playing || (buffering && wantsPlay.current) ? "Pause selected recording" : "Play selected recording"}>{jamLocked ? <Square size={19} fill="currentColor" /> : playing || (buffering && wantsPlay.current) ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><SpeedControl rate={displayedRate} disabled={jamLocked || !available || !controllable || (mode === "video" && videoRates.length < 2)} video={mode === "video"} onStep={stepSpeed} onToggle={toggleSpeed} /><span className="time">{formatTime(time)}</span><input aria-label="Seek full recording" type="range" min="0" max={baseRange.full} step="any" value={Math.max(0, Math.min(baseRange.full, time))} disabled={jamLocked || !available || !controllable || !baseRange.full} onChange={event => seekTimeline(Number(event.target.value))} /><span className="time">{baseRange.full ? formatTime(baseRange.full) : "—:—"}</span></div>
      <div className="media-switch" role="group" aria-label="Playback options"><button aria-pressed={mode !== "video"} disabled={jamLocked || row.has_audio !== "yes"} onClick={() => chooseAudio()}><AudioLines size={15} /> Audio</button><button aria-pressed={mode === "video" && videoVisible} disabled={jamLocked || row.has_video !== "yes"} onClick={() => mode === "video" && videoVisible ? closeVideo() : switchMode("video")}><Video size={15} /> Video</button><button className="open-practice-button" onClick={onSong} aria-label="Open practice">Practice</button>{(audioDownload || videoDownload) && <details className="player-downloads"><summary aria-label="Download files"><Download size={15} /><span>Download</span></summary><div className="player-download-links">{audioDownload && <a href={audioDownload} target="_blank" rel="noopener noreferrer" download><AudioLines size={15} />Download audio</a>}{videoDownload && <a href={videoDownload} target="_blank" rel="noopener noreferrer" download><Video size={15} />Download video</a>}</div></details>}<span className="mode-status" role="status">{error ? "Unavailable" : buffering ? "Buffering…" : audioRoutingPending || !ready ? "Loading…" : playing ? "Playing" : "Paused"}</span></div>
      {error && <p className="playback-error" role="alert">{error}{row.audio_file && <button onClick={() => chooseAudio(true)}>Original mix</button>}</p>}
      {practiceError && !practiceHost && <p className="practice-link-error" role="alert">{practiceError}</p>}
      <div className="video-float" hidden={mode !== "video" || !videoVisible}>
        <div className="video-window-heading"><span>{identity.title || title(row)} · Video</span><button className="icon-button" aria-label="Close video" onClick={closeVideo}><X size={16} /></button></div>
        <div className="preview">{mode === "video" && row.youtube_video_id ? <div ref={container} className="youtube-host" /> : mode === "video" && row.video_file_id ? <iframe title={`${title(row)} — Drive preview`} src={`https://drive.google.com/file/d/${encodeURIComponent(row.video_file_id)}/preview`} allow="autoplay" allowFullScreen /> : null}</div>
        {sourceVideo && <a className="video-source-link" href={sourceVideo} target="_blank" rel="noopener noreferrer">Open source video <ArrowUpRight size={14} /></a>}
      </div>
    </aside>
    {practiceHost && createPortal(<>{identity.referenceLabel && <p className="quiet-note practice-reference-label">Source: {identity.referenceLabel}</p>}{workspace}{copied && <p className="copy-status" role="status">{copied}</p>}{manualLink && <details className="practice-link-detail"><summary>Practice link</summary><input aria-label="Practice link" readOnly value={manualLink} onFocus={event => event.target.select()} /></details>}<details className="practice-source-detail"><summary>Recording details</summary><dl><dt>Source</dt><dd>{isTake ? row.file : identity.referenceLabel || identity.artist}</dd><dt>{isTake ? "Played key" : "Reference key"}</dt><dd>{identity.musicalKey || "Not recorded"}</dd><dt>Tempo</dt><dd>{identity.bpm ? `${identity.bpm} BPM` : "Not recorded"}</dd></dl><div className="source-actions">{sourceVideo && <a href={sourceVideo} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15} /> Open video</a>}{row.audio_url && <a href={row.audio_url} target="_blank" rel="noopener noreferrer">Open audio</a>}</div></details></>, practiceHost)}
  </>;
}
