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
  const [playRequest, setPlayRequest] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const [videoOpen, setVideoOpen] = useState(false);
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
  const routeKey = `${browse.view}:${browse.song}:${browse.session}`;
  const dock = new URL(location.href).searchParams.get("layout") === "dock";

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
  }, [rows]);
  function navigate(view: View, song = "", session = "") {
    scrolls.current.set(routeKey, main.current?.scrollTop || 0);
    const href = catalogHref(location.href, view, song, session);
    history.pushState(null, "", href);
    setBrowse(route(href));
  }
  function searchFor(q: string) {
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
    const different = selectedRef.current !== id;
    selectedRef.current = id;
    if (different) practiceTarget.current = { t: null, repeat: null, section: null };
    setSelected(id);
    setAutoPlay(play);
    setPlayRequest((current) => current + 1);
    const url = new URL(location.href);
    url.searchParams.set("play", id);
    if (different) {
      url.searchParams.delete("t");
      url.searchParams.delete("repeat");
      url.searchParams.delete("section");
    }
    url.hash = "";
    history.replaceState(history.state, "", url);
  }
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
  const active = referenceMedia || rows.find((row) => row.file === selected);
  const takeLink = catalog?.recordings.find((row) => row.file === selected);
  const activeSong =
    refSong || catalog?.songs.find((song) => song.id === takeLink?.song_id);
  const props = {
    catalog,
    rows,
    navigate,
    play: (row: Recording) => select(row.file),
    playReference: (reference: SongReference) => select(`ref:${reference.id}`),
    active: selected,
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
      className={`app-shell ${dock ? "layout-dock" : "layout-rail"} ${videoOpen ? "media-open" : ""}`}
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
            <SongPage {...props} songId={browse.song} />
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
            autoPlay={autoPlay}
            playRequest={playRequest}
            onFilter={searchFor}
            identity={{
              title: activeSong?.title,
              kind: refItem ? refItem.kind : "our take",
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
            onSong={() => activeSong && navigate("songs", activeSong.id)}
          />
        ) : (
          <aside className="player player-idle" aria-label="Music player">
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
