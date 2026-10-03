import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "./Player";
import {
  driveDownload,
  fileFromHash,
  filterRows,
  formatTime,
  groups,
  hashForFile,
  parseCsv,
  pathForSession,
  searchFields,
  sessionDriveUrls,
  sessionFromHref,
  title,
  validSession,
} from "./recordings";
import type { MediaFilter, Recording, SortKey } from "./recordings";

function Highlight({ value, query }: { value: string; query: string }) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return <>{value}</>;
  const parts = [];
  let cursor = 0;
  let index = value.toLocaleLowerCase().indexOf(needle);
  while (index >= 0) {
    parts.push(
      <Fragment key={cursor}>
        {value.slice(cursor, index)}
        <mark>{value.slice(index, index + needle.length)}</mark>
      </Fragment>,
    );
    cursor = index + needle.length;
    index = value.toLocaleLowerCase().indexOf(needle, cursor);
  }
  return (
    <>
      {parts}
      {value.slice(cursor)}
    </>
  );
}
function sessionName(row: Recording) {
  return row.session_label.replace(/^\d{4}-\d{2}-\d{2}\s*/, "");
}
function sessionDate(row: Recording) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${row.recorded_create_date.slice(0, 10)}T00:00:00Z`));
}
export function App() {
  const [rows, setRows] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [media, setMedia] = useState<MediaFilter>("all");
  const [session, setSession] = useState(sessionFromHref(location.href));
  const [sort, setSort] = useState<SortKey>("take");
  const [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [playRequest, setPlayRequest] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [downloads, setDownloads] = useState<Set<string>>(new Set());
  const [downloadMessage, setDownloadMessage] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => element.parentElement?.style.setProperty(
      "--toolbar-height", `${element.getBoundingClientRect().height}px`,
    );
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("data/recordings.csv", { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error("Could not load the recording archive.");
        return response.text();
      })
      .then((text) => {
        const records = parseCsv(text);
        const restored = validSession(sessionFromHref(location.href), [
          "all",
          ...records.map((row) => row.session_id),
        ]);
        history.replaceState(null, "", pathForSession(location.href, restored));
        setRows(records);
        setSession(restored);
        setSelected(fileFromHash(location.hash, records));
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);
  const visible = useMemo(
    () => filterRows(rows, query, media, session, sort, ascending),
    [rows, query, media, session, sort, ascending],
  );
  const active = visible.find((row) => row.file === selected) || visible[0];
  const sessions = useMemo(() => groups(rows), [rows]);
  const takeNumbers = useMemo(
    () =>
      new Map(
        groups(rows).flatMap(([, records]) =>
          [...records]
            .sort(
              (a, b) =>
                a.recorded_create_date.localeCompare(b.recorded_create_date) ||
                a.file.localeCompare(b.file),
            )
            .map(
              (row, i) => [row.file, String(i + 1).padStart(2, "0")] as const,
            ),
        ),
      ),
    [rows],
  );
  const chosen = visible.filter((row) => downloads.has(row.file));
  useEffect(() => {
    const files = new Set(visible.map((row) => row.file));
    setDownloads(
      (previous) => new Set([...previous].filter((file) => files.has(file))),
    );
    if (active) {
      setSelected(active.file);
      if (location.hash && fileFromHash(location.hash, rows) !== active.file) {
        const url = new URL(location.href);
        url.hash = hashForFile(active.file);
        history.replaceState(null, "", url);
      }
    }
  }, [visible, active?.file, rows]);
  useEffect(() => {
    function restore() {
      const file = fileFromHash(location.hash, rows);
      // In-page anchors such as the skip link are not recording links.
      if (!file && document.getElementById(location.hash.slice(1))) return;
      const value = validSession(sessionFromHref(location.href), [
        "all",
        ...rows.map((row) => row.session_id),
      ]);
      history.replaceState(null, "", pathForSession(location.href, value));
      setSession(value);
      setQuery("");
      setMedia("all");
      setSelected(file);
      setAutoPlay(false);
    }
    window.addEventListener("hashchange", restore);
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("popstate", restore);
    };
  }, [rows]);
  useEffect(() => {
    function typeToSearch(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.keyCode === 229 ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.key.length !== 1 ||
        e.key === " " ||
        (e.target instanceof Element &&
          e.target.closest("input,select,textarea,button,a,[contenteditable]"))
      )
        return;
      e.preventDefault();
      search.current?.focus();
      setQuery((q) => q + e.key);
      setAutoPlay(false);
    }
    document.addEventListener("keydown", typeToSearch);
    return () => document.removeEventListener("keydown", typeToSearch);
  }, []);
  function changeSession(value: string) {
    setSession(value);
    setAutoPlay(false);
    history.replaceState(null, "", pathForSession(location.href, value));
  }
  function filter(value: string) {
    setQuery(value);
    setAutoPlay(false);
  }
  function changeSort(value: SortKey) {
    setAscending(sort === value ? !ascending : value === "recording");
    setSort(value);
  }
  function choose(row: Recording) {
    setSelected(row.file);
    setAutoPlay(true);
    setPlayRequest((n) => n + 1);
    const url = new URL(location.href);
    url.hash = hashForFile(row.file);
    history.replaceState(null, "", url);
  }
  function toggleDownload(file: string) {
    setDownloads((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }
  function download() {
    chosen.forEach((row) => {
      const link = document.createElement("a");
      link.href = driveDownload(row.video_file_id || row.audio_file_id);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = "";
      document.body.append(link);
      link.click();
      link.remove();
    });
    setDownloadMessage(
      "Downloads requested. If your browser blocks multiple downloads, use the individual links below.",
    );
  }
  const total = rows.reduce(
    (sum, row) => sum + Number(row.duration_seconds),
    0,
  );
  const currentTotal = visible.reduce(
    (sum, row) => sum + Number(row.duration_seconds),
    0,
  );
  const pageLink = new URL(location.href);
  if (active) pageLink.hash = hashForFile(active.file);
  return (
    <>
      <a className="skip-link" href="#recordings">
        Skip to recordings
      </a>
      <header className="masthead">
        <div className="identity">
          <span className="archive-mark" aria-hidden="true">
            VGM
          </span>
          <div>
            <h1>Music Jam Sessions</h1>
            <p>Recording archive · 2026</p>
          </div>
        </div>
        <div className="archive-utility">
          <span>
            {rows.length} takes / {formatTime(total)}
          </span>
          <a href="data/recordings.csv" download>
            Export CSV
          </a>
        </div>
      </header>
      <main className={active ? "has-player" : ""}>
        <section ref={toolbar} className="toolbar" aria-label="Search and filter recordings">
          <label className="search-field">
            Search
            <input
              ref={search}
              type="search"
              placeholder="Song, game, filename, or player"
              value={query}
              onChange={(e) => filter(e.target.value)}
            />
          </label>
          <label>
            Session
            <select
              value={session}
              onChange={(e) => changeSession(e.target.value)}
            >
              <option value="all">All sessions</option>
              {sessions.map(([id, records]) => (
                <option key={id} value={id}>
                  {sessionDate(records[0])} · {sessionName(records[0])}
                </option>
              ))}
            </select>
          </label>
          <label>
            Media
            <select
              value={media}
              onChange={(e) => {
                setMedia(e.target.value as MediaFilter);
                setAutoPlay(false);
              }}
            >
              <option value="all">All media</option>
              <option value="video">Has video</option>
              <option value="audio">Has audio</option>
              <option value="audio-only">Audio only</option>
            </select>
          </label>
        </section>
        {loading ? (
          <p className="empty-state" role="status">
            Loading recordings…
          </p>
        ) : error ? (
          <div className="empty-state" role="alert">
            <h2>Archive unavailable</h2>
            <p>{error}</p>
            <button onClick={() => setReload(reload + 1)}>Try again</button>
          </div>
        ) : (
          <div className="workspace">
            <section
              id="recordings"
              className="ledger"
              aria-label="Recordings"
              tabIndex={-1}
            >
              <div className="ledger-toolbar">
                <p aria-live="polite">
                  <strong>{visible.length}</strong> takes{" "}
                  <span>· {formatTime(currentTotal)}</span>
                </p>
                <div className="list-tools">
                  <button
                    aria-pressed={selecting}
                    onClick={() => {
                      setSelecting(!selecting);
                      setDownloads(new Set());
                      setDownloadMessage("");
                    }}
                  >
                    {selecting ? "Done" : "Select"}
                  </button>
                </div>
              </div>
              {selecting && (
                <div className="selection-toolbar">
                  <span>{chosen.length} selected</span>
                  <button
                    onClick={() =>
                      setDownloads(
                        chosen.length === visible.length
                          ? new Set()
                          : new Set(visible.map((row) => row.file)),
                      )
                    }
                  >
                    {chosen.length === visible.length && visible.length
                      ? "Clear selection"
                      : "Select all shown"}
                  </button>
                  <button disabled={!chosen.length} onClick={download}>
                    Download selected
                  </button>
                  {downloadMessage && (
                    <div role="status">
                      <p>{downloadMessage}</p>
                      {chosen.map((row) => (
                        <a
                          key={row.file}
                          href={driveDownload(
                            row.video_file_id || row.audio_file_id,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {title(row)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {session === "all" && groups(visible).length > 1 && (
                <nav className="session-jumps" aria-label="Jump to session">
                  {groups(visible).map(([id, records]) => (
                    <button
                      key={id}
                      onClick={() =>
                        document
                          .getElementById(`heading-${id}`)
                          ?.scrollIntoView({ block: "start" })
                      }
                    >
                      {sessionDate(records[0])}
                    </button>
                  ))}
                </nav>
              )}
              {visible.length === 0 ? (
                <div className="empty-state">
                  <h2>No matching recordings</h2>
                  <p>Try another song, game, or player.</p>
                  <button
                    onClick={() => {
                      filter("");
                      setMedia("all");
                      changeSession("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                groups(visible).map(([id, records]) => (
                  <section
                    key={id}
                    className="session-group"
                    aria-labelledby={`heading-${id}`}
                  >
                    <header className="session-band">
                      <div>
                        <span>{sessionDate(records[0])}</span>
                        <h2 id={`heading-${id}`}>{sessionName(records[0])}</h2>
                      </div>
                      <span className="session-count">
                        {records.length} takes
                      </span>
                      <nav aria-label={`${sessionDate(records[0])} resources`}>
                        {sessionDriveUrls[id] && (
                          <a
                            href={sessionDriveUrls[id]}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Drive folder
                          </a>
                        )}
                        {(records[0].youtube_playlist_url ||
                          records[0].youtube_playlist_id) && (
                          <a
                            href={
                              records[0].youtube_playlist_url ||
                              `https://www.youtube.com/playlist?list=${encodeURIComponent(records[0].youtube_playlist_id)}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Playlist
                          </a>
                        )}
                      </nav>
                    </header>
                    <div className="ledger-headings" aria-label="Sort recordings">
                      {([ ["take", "Take"], ["recording", "Recording"], ["time", "Time"] ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          aria-label={`Sort by ${label}${sort === key ? `, ${ascending ? "ascending" : "descending"}` : ""}`}
                          aria-pressed={sort === key}
                          onClick={() => changeSort(key)}
                        >
                          {label} <span aria-hidden="true">{sort === key ? ascending ? "↑" : "↓" : "↕"}</span>
                        </button>
                      ))}
                    </div>
                    <ol className="recording-list">
                      {records.map((row) => {
                        const hiddenMatch = query.trim()
                          ? searchFields.find(
                              (key) =>
                                ![
                                  "caption",
                                  "song_name",
                                  "game_title",
                                  "franchise",
                                ].includes(key) &&
                                row[key]
                                  .toLocaleLowerCase()
                                  .includes(query.trim().toLocaleLowerCase()),
                            )
                          : undefined;
                        const names = [
                          ...new Set(
                            [row.drums, row.piano, row.guitar, row.bass].filter(
                              Boolean,
                            ),
                          ),
                        ].join(" · ");
                        return (
                          <li
                            key={row.file}
                            className={`recording-row ${active?.file === row.file ? "selected" : ""}`}
                          >
                            {selecting && (
                              <input
                                className="download-check"
                                type="checkbox"
                                checked={downloads.has(row.file)}
                                onChange={() => toggleDownload(row.file)}
                                aria-label={`Select ${title(row)} for download`}
                              />
                            )}
                            <button
                              className="take-button"
                              onClick={() => choose(row)}
                              aria-label={`Play ${title(row)}, take ${takeNumbers.get(row.file)}`}
                              aria-current={
                                active?.file === row.file ? "true" : undefined
                              }
                            >
                              <span className="take-number">
                                {takeNumbers.get(row.file)}
                              </span>
                              <img
                                src={row.thumbnail}
                                alt=""
                                loading="lazy"
                                width="96"
                                height="60"
                              />
                            </button>
                            <div className="recording-copy">
                              <button
                                className="recording-title"
                                onClick={() => choose(row)}
                              >
                                <Highlight value={title(row)} query={query} />
                              </button>
                              <div className="game-links">
                                {[
                                  ...new Set(
                                    [row.franchise, row.game_title].filter(
                                      Boolean,
                                    ),
                                  ),
                                ].map((value) => (
                                  <button
                                    key={value}
                                    className="text-link"
                                    onClick={() => filter(value)}
                                  >
                                    <Highlight value={value} query={query} />
                                  </button>
                                ))}
                                {row.song_name &&
                                  row.song_name !== title(row) && (
                                    <button
                                      className="text-link"
                                      onClick={() => filter(row.song_name)}
                                    >
                                      <Highlight
                                        value={row.song_name}
                                        query={query}
                                      />
                                    </button>
                                  )}
                              </div>
                              <p className="row-players">
                                <Highlight value={names} query={query} />
                              </p>
                              {hiddenMatch && (
                                <p className="match-context">
                                  {hiddenMatch.replaceAll("_", " ")}:{" "}
                                  <Highlight
                                    value={row[hiddenMatch]}
                                    query={query}
                                  />
                                </p>
                              )}
                            </div>
                            <div className="row-meta">
                              <span className="duration">{row.length}</span>
                              <span>
                                {row.has_video === "yes"
                                  ? "Video + audio"
                                  : "Audio only"}
                              </span>
                              <span className="selection-label">
                                {active?.file === row.file ? "Selected" : ""}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))
              )}
            </section>
            {active && (
              <Player
                key={active.file}
                row={active}
                autoPlay={autoPlay}
                playRequest={playRequest}
                pageLink={pageLink.toString()}
                onFilter={filter}
              />
            )}
          </div>
        )}
      </main>
    </>
  );
}
