import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  CalendarDays,
  Disc3,
  FileMusic,
  ListMusic,
  Search,
  X,
} from "lucide-react";
import { Player } from "./Player";
import { catalogHref, route } from "./Catalog";
import type { CatalogData, SongReference, View } from "./Catalog";
import {
  PageHeader,
  SearchPage,
  SessionsPage,
  SongPage,
  SongsPage,
  TakesPage,
} from "./Library";
import { referenceRow } from "./musicLibrary";
import { fileFromHash, parseCsv } from "./recordings";
import type { Recording } from "./recordings";
import { JamLibrary, jamLink } from './JamLibrary';
import { fetchJam } from './jamData';
import type { Jam, JamComment } from './jamData';

export function App() {
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [rows, setRows] = useState<Recording[]>([]);
  const [archiveError, setArchiveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [browse, setBrowse] = useState(() => route(location.href));
  const [selected, setSelected] = useState(
    () => new URL(location.href).searchParams.get("play") || "",
  );
  const selectedRef = useRef(selected);
  const practiceTarget = useRef({
    t: new URL(location.href).searchParams.get("t"),
    repeat: new URL(location.href).searchParams.get("repeat"),
    section: new URL(location.href).searchParams.get("section"),
  });
  const [autoPlay, setAutoPlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [jamToReplay, setJamToReplay] = useState<Jam | null>(null);
  const [jamReplayRequest, setJamReplayRequest] = useState(0);
  const [jamReplayStart, setJamReplayStart] = useState(0);
  const [jamRefresh, setJamRefresh] = useState(0);
  const [jamNotice, setJamNotice] = useState('');
  const [commentSeek, setCommentSeek] = useState<{ request: number; seconds: number }>();
  const [highlightedComment, setHighlightedComment] = useState(() => new URL(location.href).searchParams.get('comment') || '');
  const initialJamHref = useRef(location.href);
  const [playRequest, setPlayRequest] = useState(0);
  const [preferredMode, setPreferredMode] = useState<"audio" | "video" | undefined>();
  const [playbackRate, setPlaybackRate] = useState(1);
  const [changedRate, setChangedRate] = useState(1);
  function changeRate(rate: number) {
    if (!Number.isFinite(rate)) return;
    const next = Math.max(.5, Math.min(2, rate));
    setPlaybackRate(next);
    if (next !== 1) setChangedRate(next);
  }
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [practiceHost, setPracticeHost] = useState<HTMLDivElement | null>(null);
  const origin = useRef(
    history.state?.searchOrigin &&
      route(history.state.searchOrigin).view !== "search"
      ? history.state.searchOrigin
      : route(location.href).view === "search"
        ? catalogHref(location.href, "songs")
        : location.href,
  );
  const scrolls = useRef(new Map<string, number>());
  const hydrated = useRef(false);
  const routeKey = `${browse.view}:${browse.song}:${browse.session}:${browse.songTab}`;
  const dock = true;

  useEffect(() => {
    const controller = new AbortController();
    fetch("data/catalog.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the songbook.");
        return response.json();
      })
      .then(setCatalog)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setCatalogError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setArchiveError("");
    fetch("data/recordings.csv", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the take archive.");
        return response.text();
      })
      .then((text) => {
        const records = parseCsv(text);
        setRows(records);
        setLoading(false);
        if (!hydrated.current) {
          hydrated.current = true;
          const legacy = fileFromHash(location.hash, records);
          if (!selectedRef.current && legacy) {
            selectedRef.current = legacy;
            setSelected(legacy);
            const url = new URL(location.href);
            url.searchParams.set("play", legacy);
            url.searchParams.set("view", route(location.href).view);
            url.hash = "";
            history.replaceState(history.state, "", url);
          }
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setArchiveError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: scrolls.current.get(routeKey) || 0 });
  }, [routeKey]);
  useEffect(() => {
    function restore() {
      if (captureBusy) { history.pushState(history.state, '', captureHref.current); setJamNotice('Stop recording before changing pages.'); return; }
      // History owns browsing; a previous route must never replace live playback.
      const url = new URL(location.href);
      selectedRef.current
        ? url.searchParams.set("play", selectedRef.current)
        : url.searchParams.delete("play");
      if (fileFromHash(url.hash, rows)) {
        url.searchParams.set("view", route(url.toString()).view);
        url.hash = "";
      }
      for (const [key, value] of Object.entries(practiceTarget.current))
        value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
      history.replaceState(history.state, "", url);
      setBrowse(route(url.toString()));
      if (history.state?.searchOrigin)
        origin.current = history.state.searchOrigin;
    }
    function hash() {
      const file = fileFromHash(location.hash, rows);
      if (file) {
        select(file, false);
      }
    }
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", hash);
    };
  }, [rows, captureBusy]);
  const captureHref = useRef(location.href);
  useEffect(() => { if (captureBusy) captureHref.current = location.href; }, [captureBusy]);
  function navigate(view: View, song = "", session = "") {
    if (captureBusy) { setJamNotice('Stop recording before changing pages.'); return; }
    scrolls.current.set(routeKey, main.current?.scrollTop || 0);
    const url = new URL(catalogHref(location.href, view, song, session));
    if (view === "songs" && song && activeSong?.id !== song && isPlaying)
      url.searchParams.set("tab", "overview");
    const href = url.toString();
    history.pushState(null, "", href);
    if (view === "songs" && song && activeSong?.id !== song && !isPlaying)
      openSongSource(song);
    setBrowse(route(href));
  }
  function openSongSource(songId: string) {
    const references = catalog?.references.filter(ref => ref.song_id === songId) || [];
    const reference = references.find(ref => ref.kind === "original") || references[0];
    if (reference) {
      select(`ref:${reference.id}`, false);
      return;
    }
    const take = rows.filter(row => catalog?.recordings.some(link => link.song_id === songId && link.file === row.file))
      .sort((a, b) => b.recorded_create_date.localeCompare(a.recorded_create_date))[0];
    if (take) select(take.file, false);
  }
  useEffect(() => {
    if (catalog && !loading && !selected && browse.view === "songs" && browse.song && browse.songTab === "practice")
      openSongSource(browse.song);
  }, [catalog, loading, selected, browse.view, browse.song, browse.songTab]);
  function searchFor(q: string) {
    if (captureBusy) return;
    if (!q.trim()) {
      if (browse.view === "search") clearSearch();
      return;
    }
    const starting = browse.view !== "search";
    if (starting) {
      origin.current = location.href;
      scrolls.current.set(routeKey, main.current?.scrollTop || 0);
    }
    const href = catalogHref(location.href, "search", "", "", q);
    history[starting ? "pushState" : "replaceState"](
      { searchOrigin: origin.current },
      "",
      href,
    );
    setBrowse(route(href));
  }
  function clearSearch() {
    const url = new URL(origin.current);
    selectedRef.current
      ? url.searchParams.set("play", selectedRef.current)
      : url.searchParams.delete("play");
    for (const [key, value] of Object.entries(practiceTarget.current))
      value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.replaceState(null, "", url);
    setBrowse(route(url.toString()));
    search.current?.focus();
  }
  function select(id: string, play = true) {
    if (captureBusy) { setJamNotice('Stop recording before changing the source.'); return; }
    const different = selectedRef.current !== id;
    selectedRef.current = id;
    if (different) practiceTarget.current = { t: null, repeat: null, section: null };
    setSelected(id);
    setAutoPlay(play);
    const take = rows.find(row => row.file === id);
    setPreferredMode(play && take?.has_video === "yes" ? "video" : undefined);
    setPlayRequest((current) => current + 1);
    const url = new URL(location.href);
    url.searchParams.set("play", id);
    if (different) {
      url.searchParams.delete("t");
      url.searchParams.delete("repeat");
      url.searchParams.delete("section");
      ['jam', 'comment', 'clock', 'at'].forEach(key => url.searchParams.delete(key));
      setJamToReplay(null); setHighlightedComment('');
    }
    url.hash = "";
    history.replaceState(history.state, "", url);
  }
  function prepareJam(jam: Jam, seconds = 0) {
    if (captureBusy) { setJamNotice('Stop recording before opening another jam.'); return; }
    const backing = jam.backingMix?.source.recording;
    if (backing && backing.kind !== 'jam' && jam.backingAvailability.available)
      select(backing.kind === 'reference' ? `ref:${backing.id}` : backing.id, false);
    else if (activeSong?.id !== jam.songId) openSongSource(jam.songId);
    setJamToReplay(jam); setJamReplayStart(seconds); setJamReplayRequest(value => value + 1);
    const url = new URL(jamLink(location.href, jam.songId, jam));
    if (seconds) { url.searchParams.set('clock', 'mic'); url.searchParams.set('at', String(seconds)); }
    history.replaceState(history.state, '', url); setBrowse(route(url.toString()));
  }
  function openComment(comment: JamComment, jam: Jam | null) {
    if (captureBusy) { setJamNotice('Stop recording before opening a comment.'); return; }
    const at = comment.target.kind === 'recording' ? comment.target.at : null;
    const seconds = at ? at.kind === 'point' ? at.seconds : at.start : 0;
    if (jam) prepareJam(jam, seconds);
    else if (comment.target.kind === 'recording') {
      const recording = comment.target.recording;
      if (recording.kind !== 'jam') select(recording.kind === 'reference' ? `ref:${recording.id}` : recording.id, false);
      if (at) setCommentSeek(previous => ({ request: (previous?.request || 0) + 1, seconds }));
    }
    const href = jamLink(location.href, browse.song, jam, comment);
    history.replaceState(history.state, '', href); setBrowse(route(href)); setHighlightedComment(comment.id);
  }
  useEffect(() => {
    if (!catalog || loading) return;
    const url = new URL(initialJamHref.current), id = url.searchParams.get('jam');
    const clock = url.searchParams.get('clock'), at = Number(url.searchParams.get('at') || 0);
    let disposed = false;
    if (id) fetchJam(id).then(jam => {
      if (!disposed && jam.songId === browse.song) {
        setJamToReplay(jam); setJamReplayStart(clock === 'mic' && Number.isFinite(at) && at >= 0 ? at : 0); setJamReplayRequest(value => value + 1);
        const restored = new URL(location.href); restored.searchParams.set('jam', id);
        for (const key of ['comment', 'clock', 'at']) { const value = url.searchParams.get(key); if (value !== null) restored.searchParams.set(key, value); }
        history.replaceState(history.state, '', restored); setHighlightedComment(url.searchParams.get('comment') || '');
      }
    }).catch(error => { if (!disposed) setJamNotice(error.message); });
    else if (clock === 'source' && url.searchParams.has('at') && Number.isFinite(at) && at >= 0)
      setCommentSeek(previous => ({ request: (previous?.request || 0) + 1, seconds: at }));
    return () => { disposed = true; };
  }, [catalog, loading]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const interactive =
        event.target instanceof Element &&
        event.target.closest(
          "input,textarea,select,button,a,[contenteditable]",
        );
      if (event.key === "/" && !interactive) {
        event.preventDefault();
        search.current?.focus();
      }
      if (
        event.key === "Escape" &&
        event.target === search.current &&
        browse.view === "search"
      ) {
        event.preventDefault();
        clearSearch();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const refItem = catalog?.references.find(
    (ref) => `ref:${ref.id}` === selected,
  );
  const refSong = catalog?.songs.find((song) => song.id === refItem?.song_id);
  const referenceMedia = useMemo(
    () => (refItem && refSong ? referenceRow(refItem, refSong) : undefined),
    [refItem, refSong],
  );
  const archivedMedia = rows.find((row) => row.file === selected);
  const jamSong = catalog?.songs.find(song => song.id === jamToReplay?.songId);
  // A retained mic take must remain usable even when its backing disappeared.
  // This host has no backing media and cannot pretend to be an exact source.
  const micOnlyHost = jamSong && jamToReplay && browse.song === jamSong.id && !referenceMedia && !archivedMedia
    ? { ...referenceRow({ id:`jam-host-${jamToReplay.id}`, song_id:jamSong.id, kind:'jam', label:'Microphone recording', artist:null, url:'' }, jamSong), has_audio:'no', has_video:'no', audio_file:'', youtube_video_id:'', youtube_url:'' }
    : undefined;
  const active = referenceMedia || archivedMedia || micOnlyHost;
  const takeLink = catalog?.recordings.find((row) => row.file === selected);
  const activeSong =
    refSong || catalog?.songs.find((song) => song.id === takeLink?.song_id) || (micOnlyHost ? jamSong : undefined);
  const props = {
    catalog,
    rows,
    navigate,
    play: (row: Recording) => select(row.file),
    playReference: (reference: SongReference) => select(`ref:${reference.id}`),
    active: selected,
    prepare: (row: Recording) => select(row.file, false),
    prepareReference: (reference: SongReference) => select(`ref:${reference.id}`, false),
  };
  const nav = [
    ["songs", "Songs", FileMusic],
    ["repertoire", "Repertoire", ListMusic],
    ["recordings", "Our takes", AudioLines],
    ["sessions", "Sessions", CalendarDays],
  ] as const;
  const currentNav = browse.view === "search" ? "" : browse.view;
  return (
    <div
      className={`app-shell full-practice-shell ${dock ? "layout-dock" : "layout-rail"} ${videoOpen ? "media-open" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to library
      </a>
      <nav className="workspace-nav" aria-label="Music workspace">
        <a
          className="brand"
          aria-label="VGM music workspace"
          href={catalogHref(location.href, "songs")}
          onClick={(e) => {
            e.preventDefault();
            navigate("songs");
          }}
        >
          <span className="brand-symbol">
            <Disc3 size={25} />
          </span>
          <span>
            VGM<span className="brand-subtitle">Music workspace</span>
          </span>
        </a>
        <span className="nav-caption">LIBRARY</span>
        <div className="nav-items">
          {nav.map(([view, label, Icon]) => (
            <a
              key={view}
              aria-label={label}
              title={label}
              href={catalogHref(location.href, view)}
              aria-current={currentNav === view ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(view);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {view === "songs" && catalog && (
                <small>{catalog.songs.length}</small>
              )}
            </a>
          ))}
        </div>
        <div className="nav-foot">
          <span className="live-dot" /> A place to listen & play
        </div>
      </nav>
      <header className="workspace-topbar">
        <div className="global-search">
          <Search size={19} />
          <input
            ref={search}
            type="search"
            aria-label="Search music library"
            placeholder="Search songs, games, takes, people…"
            disabled={captureBusy}
            value={browse.q}
            onChange={(e) => searchFor(e.target.value)}
          />
          {browse.q ? (
            <button
              className="icon-button"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <X size={17} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        <span className="workspace-label">THE MUSIC ROOM</span>
      </header>
      <main
        ref={main}
        id="main-content"
        className="workspace-main"
        tabIndex={-1}
      >
        {selected && !active && !loading && catalog && (
          <p className="load-error" role="alert">
            The linked recording or listening source is unavailable. Choose a
            source from the library.
          </p>
        )}
        {catalogError && <p role="alert">{catalogError}</p>}
        {jamNotice && <p role="status">{jamNotice}</p>}
        {archiveError && (
          <div className="load-error" role="alert">
            {archiveError}{" "}
            <button onClick={() => setReload((current) => current + 1)}>
              Retry takes
            </button>
          </div>
        )}
        {!catalog && !catalogError && <p role="status">Loading songbook…</p>}
        {browse.view === "songs" &&
          catalog &&
          (browse.song ? (
            <><SongPage {...props} songId={browse.song} songTab={browse.songTab}
              practiceActive={Boolean(active && activeSong?.id === browse.song)} practiceHostRef={setPracticeHost}
              onTab={tab => {
                if (captureBusy) { setJamNotice('Stop recording before changing views.'); return; }
                const url = new URL(location.href); url.searchParams.set("tab", tab);
                history.pushState(null, "", url);
                if (tab === "practice" && activeSong?.id !== browse.song) openSongSource(browse.song);
                setBrowse(route(url.toString()));
              }} /><JamLibrary key={browse.song} songId={browse.song} catalog={catalog} rows={rows}
                activeRecording={selected ? { kind: selected.startsWith('ref:') ? 'reference' : 'archive', id: selected.startsWith('ref:') ? selected.slice(4) : selected } : null}
                refresh={jamRefresh} highlightedComment={highlightedComment} onReplay={prepareJam} onCommentOpen={openComment} /></>
          ) : (
            <SongsPage {...props} />
          ))}
        {browse.view === "repertoire" && catalog && (
          <SongsPage {...props} repertoire />
        )}
        {browse.view === "recordings" &&
          (loading && !rows.length ? (
            <>
              <PageHeader title="Takes" />
              <p role="status">Loading takes…</p>
            </>
          ) : (
            <TakesPage {...props} />
          ))}
        {browse.view === "sessions" && catalog && (
          <SessionsPage {...props} sessionId={browse.session} />
        )}
        {browse.view === "search" && <SearchPage {...props} query={browse.q} />}
      </main>
      <div className="persistent-player">
        {active ? (
          <Player
            key={selected}
            row={active}
            practiceHost={browse.view === "songs" && browse.songTab === "practice" && activeSong?.id === browse.song ? practiceHost : null}
            autoPlay={autoPlay}
            preferredMode={preferredMode}
            playbackRate={playbackRate}
            changedRate={changedRate}
            onRateChange={changeRate}
            playRequest={playRequest}
            identity={{
              title: activeSong?.title,
              kind: refItem ? refItem.kind : "our take",
              referenceLabel: refItem?.label,
              artist: refItem?.artist || "",
              songId: activeSong?.id || "",
              musicalKey: refItem
                ? refItem.kind === "original"
                  ? activeSong?.reference_key
                  : null
                : takeLink?.played_key,
              bpm: refItem
                ? refItem.kind === "original"
                  ? activeSong?.reference_bpm
                  : null
                : takeLink?.played_bpm,
            }}
            onPracticeTargetChange={(href) => {
              const url = new URL(href);
              practiceTarget.current = {
                t: url.searchParams.get("t"),
                repeat: url.searchParams.get("repeat"),
                section: url.searchParams.get("section"),
              };
              setBrowse((current) => ({ ...current }));
            }}
            onVideoVisibility={setVideoOpen}
            onPlayingChange={setIsPlaying}
            jamToReplay={jamToReplay} jamReplayRequest={jamReplayRequest} jamReplayStart={jamReplayStart}
            commentSeek={commentSeek} onJamCaptureBusy={setCaptureBusy} onJamSaved={jam => {
              setJamRefresh(value => value + 1);
              if (browse.song === jam.songId) { history.replaceState(history.state, '', jamLink(location.href, jam.songId, jam)); setHighlightedComment(''); }
            }}
            onSong={() => activeSong && navigate("songs", activeSong.id)}
          />
        ) : (
          <aside className="player player-idle compact-idle" aria-label="Music player">
            <div className="player-heading">
              <span className="player-status">NOW PLAYING</span>
              <h2>A little room to listen</h2>
            </div>
            <div className="idle-art">
              <HeadphoneArt />
            </div>
            <p>
              Choose an original or one of our takes.
              <br />
              Keep listening as you explore.
            </p>
            <div className="idle-transport">
              <span />
              <span />
              <span />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
function HeadphoneArt() {
  return <AudioLines size={55} strokeWidth={1} />;
}
