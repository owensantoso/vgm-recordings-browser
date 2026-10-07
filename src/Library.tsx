import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Check,
  Disc3,
  Download,
  FileMusic,
  Headphones,
  Link2,
  ListMusic,
  Play,
  Video,
} from "lucide-react";
import type { CatalogData, Song, SongReference, View } from "./Catalog";
import { catalogHref } from "./Catalog";
import type { MediaFilter, Recording, SortKey } from "./recordings";
import {
  driveDownload,
  filterRows,
  formatTime,
  groups,
  title,
} from "./recordings";
import { searchLibrary, youtubeId } from "./musicLibrary";
export type Navigate = (view: View, song?: string, session?: string) => void;
export function Highlight({
  value,
  query = "",
}: {
  value: string;
  query?: string;
}) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return <>{value}</>;
  const parts = [];
  let cursor = 0,
    index = value.toLocaleLowerCase().indexOf(needle);
  while (index >= 0) {
    parts.push(
      <span key={cursor}>
        {value.slice(cursor, index)}
        <mark>{value.slice(index, index + needle.length)}</mark>
      </span>,
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
function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}
function EntityLink({
  view,
  song = "",
  session = "",
  navigate,
  children,
  className = "",
  ariaLabel,
}: {
  view: View;
  song?: string;
  session?: string;
  navigate: Navigate;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <a
      className={className}
      aria-label={ariaLabel}
      href={catalogHref(location.href, view, song, session)}
      onClick={(e) => {
        e.preventDefault();
        navigate(view, song, session);
      }}
    >
      {children}
    </a>
  );
}
export function PageHeader({
  title: label,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1 tabIndex={-1}>{label}</h1>
        {meta && <p>{meta}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
export function FilterButtons<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="filter-group" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          aria-pressed={key === value}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
function MusicValues({
  musicalKey,
  bpm,
  prefix = "",
}: {
  musicalKey?: string | null;
  bpm?: number | null;
  prefix?: string;
}) {
  return musicalKey || bpm ? (
    <span className="music-values">
      {prefix}
      {musicalKey}
      {musicalKey && bpm ? " · " : ""}
      {bpm ? `${bpm} BPM` : ""}
    </span>
  ) : null;
}
export interface LibraryProps {
  catalog: CatalogData | null;
  rows: Recording[];
  navigate: Navigate;
  play: (row: Recording) => void;
  playReference: (reference: SongReference) => void;
  active: string;
  query?: string;
  prepare?: (row: Recording) => void;
  prepareReference?: (reference: SongReference) => void;
}
function SongRow({
  song,
  context = "",
  note = "",
  ...props
}: LibraryProps & { song: Song; context?: string; note?: string }) {
  const { catalog, rows, navigate, play, playReference, query = "" } = props;
  const linked =
    catalog?.recordings.filter((link) => link.song_id === song.id) || [];
  const takes = rows
    .filter((row) => linked.some((link) => link.file === row.file))
    .sort((a, b) =>
      b.recorded_create_date.localeCompare(a.recorded_create_date),
    );
  const original =
    catalog?.references.find(
      (ref) =>
        ref.song_id === song.id &&
        ref.kind === "original" &&
        (ref.youtube_id || youtubeId(ref.url)),
    ) ||
    catalog?.references.find(
      (ref) =>
        ref.song_id === song.id && (ref.youtube_id || youtubeId(ref.url)),
    );
  const member = catalog?.repertoire.some((item) => item.song_id === song.id);
  const game = song.game || song.franchise || "";
  return (
    <li className="song-row">
      <SongThumbnail videoId={original ? original.youtube_id || youtubeId(original.url) : null} />
      <div className="song-row-copy">
        <EntityLink view="songs" song={song.id} navigate={navigate}>
          <Highlight value={song.title} query={query} />
        </EntityLink>
        <small>
          <Highlight value={game} query={query} />
          {member && (
            <span className="membership">
              <Check size={12} /> Repertoire
            </span>
          )}
        </small>
        {note && <small className="repertoire-note">{note}</small>}
        {context &&
          ![song.title, game].some((value) =>
            value.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          ) && (
            <small className="matched-context">
              Match: <Highlight value={context} query={query} />
            </small>
          )}
        <MusicValues musicalKey={song.reference_key} bpm={song.reference_bpm} />
      </div>
      <span className="take-count">
        {takes.length} {takes.length === 1 ? "take" : "takes"}
      </span>
      <div className="row-play-actions">
        {original && (
          <button
            className="quiet-button"
            onClick={() => playReference(original)}
            aria-label={`Play ${original.kind} of ${song.title}`}
          >
            <Disc3 size={15} />
            <span>
              {original.kind === "original"
                ? "Original"
                : original.kind === "cover"
                  ? "Cover"
                  : "Version"}
            </span>
          </button>
        )}
        {takes[0] && (
          <button
            className="icon-button"
            onClick={() => play(takes[0])}
            aria-label={`Play latest take of ${song.title}`}
          >
            <Play size={17} />
          </button>
        )}
      </div>
    </li>
  );
}
function ReferenceCard({
  refItem,
  song,
  playReference,
  active,
}: {
  refItem: SongReference;
  song: Song;
  playReference: (reference: SongReference) => void;
  active: string;
}) {
  const playable = refItem.youtube_id || youtubeId(refItem.url);
  return (
    <li
      className="reference-card"
      aria-current={active === `ref:${refItem.id}` ? "true" : undefined}
    >
      <span className="reference-icon">
        <Disc3 size={22} />
      </span>
      <div>
        <span className="source-kind">
          {refItem.kind === "original" ? "Original soundtrack" : refItem.kind}
        </span>
        <strong>{refItem.label}</strong>
        {refItem.artist && <small>{refItem.artist}</small>}
      </div>
      <div className="reference-actions">
        {playable && (
          <button
            onClick={() => playReference(refItem)}
            aria-label={`Play ${refItem.kind} of ${song.title} · ${refItem.label}`}
          >
            <Play size={16} /> Listen
          </button>
        )}
        <a
          href={refItem.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${refItem.label} on YouTube`}
        >
          <ArrowUpRight size={18} />
          <span>YouTube</span>
        </a>
      </div>
    </li>
  );
}
export function TakeList({
  records,
  contextByFile = new Map(),
  selection,
  ...props
}: LibraryProps & {
  records: Recording[];
  contextByFile?: Map<string, string>;
  selection?: { files: Set<string>; toggle: (file: string) => void };
}) {
  const { catalog, rows, navigate, play, active, query = "" } = props;
  const numbers = useMemo(
    () =>
      new Map(
        groups(rows).flatMap(([, records]) =>
          [...records]
            .sort((a, b) =>
              a.recorded_create_date.localeCompare(b.recorded_create_date),
            )
            .map(
              (row, i) => [row.file, String(i + 1).padStart(2, "0")] as const,
            ),
        ),
      ),
    [rows],
  );
  return (
    <ol className="recording-list">
      {records.map((row) => {
        const link = catalog?.recordings.find((link) => link.file === row.file),
          song = catalog?.songs.find((song) => song.id === link?.song_id);
        const name = song?.title || title(row),
          context = contextByFile.get(row.file);
        const original = song && catalog?.references.find(
          (ref) => ref.song_id === song.id && ref.kind === "original" &&
            (ref.youtube_id || youtubeId(ref.url)),
        );
        return (
          <li
            className="recording-row"
            key={row.file}
            aria-current={active === row.file ? "true" : undefined}
          >
            <span className="take-number">
              {selection ? (
                <input
                  type="checkbox"
                  aria-label={`Select take ${row.file}`}
                  checked={selection.files.has(row.file)}
                  onChange={() => selection.toggle(row.file)}
                />
              ) : (
                numbers.get(row.file)
              )}
            </span>
            <button
              className="take-thumbnail-button"
              onClick={() => play(row)}
              aria-label={`Play take ${row.file} from thumbnail`}
              title={`Play our take · ${name}`}
            >
              <img src={row.thumbnail} alt="" className="take-thumbnail" width="64" height="42" />
              <span className="take-thumbnail-play" aria-hidden="true"><Play size={15} fill="currentColor" /></span>
            </button>
            {song && <EntityLink
              view="songs"
              song={song.id}
              navigate={navigate}
              className="take-song-art"
              ariaLabel={`Open ${song.title} song page`}
            >
              <SongThumbnail videoId={original ? original.youtube_id || youtubeId(original.url) : null} />
              <span aria-hidden="true">Song</span>
            </EntityLink>}
            <div className="take-copy">
              <EntityLink
                view={song ? "songs" : "sessions"}
                song={song?.id}
                session={song ? "" : row.session_id}
                navigate={navigate}
              >
                <Highlight value={name} query={query} />
              </EntityLink>
              <small>
                <EntityLink
                  view="sessions"
                  session={row.session_id}
                  navigate={navigate}
                >
                  {date(row.recorded_create_date)}
                </EntityLink>
                {song?.game && (
                  <>
                    {" "}
                    · <Highlight value={song.game} query={query} />
                  </>
                )}
              </small>
              {context &&
                ![name, song?.game || ""].some((value) =>
                  value.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                ) && (
                  <small className="matched-context">
                    Match: <Highlight value={context} query={query} />
                  </small>
                )}
              <MusicValues
                musicalKey={link?.played_key}
                bpm={link?.played_bpm}
                prefix="Played "
              />
            </div>
            <div className="take-media">
              {row.has_video === "yes" && (
                <span aria-label="Has video" title="Has video">
                  <Video size={16} />
                </span>
              )}
              {row.has_audio === "yes" && (
                <span aria-label="Has audio" title="Has audio">
                  <AudioLines size={16} />
                </span>
              )}
            </div>
            <span className="duration">
              {row.length || formatTime(Number(row.duration_seconds))}
            </span>
            <button
              className="take-title icon-button"
              onClick={() => play(row)}
              aria-label={`Play take ${row.file}`}
            >
              <Play size={17} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
export function SongPage({
  songId, songTab = "practice", practiceActive = false, practiceHostRef, onTab,
  ...props
}: LibraryProps & { songId: string; songTab?: "practice" | "overview"; practiceActive?: boolean; practiceHostRef?: (element: HTMLDivElement | null) => void; onTab?: (tab: "practice" | "overview") => void }) {
  const identityHeader = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = identityHeader.current;
    const scrollPane = header?.closest(".workspace-main");
    if (!header || !scrollPane || songTab !== "practice") return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.max(0, Math.min(1, scrollPane.scrollTop / 96));
      header.style.setProperty("--identity-inset", `${-parseFloat(window.getComputedStyle(scrollPane).paddingTop || "0")}px`);
      header.style.setProperty("--identity-scale", String(1 - progress * .14));
      header.style.setProperty("--artwork-scale", String(1 - progress * .32));
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    scrollPane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { scrollPane.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); window.cancelAnimationFrame(frame); };
  }, [songId, songTab, props.catalog]);
  const { catalog, rows, navigate, playReference, active } = props,
    song = catalog?.songs.find((song) => song.id === songId);
  if (!song)
    return (
      <>
        <PageHeader title="Song not found" />
        <EntityLink view="songs" navigate={navigate}>
          Back to songs
        </EntityLink>
      </>
    );
  const refs =
    catalog?.references.filter((ref) => ref.song_id === song.id) || [];
  const originals = refs.filter((ref) => ref.kind === "original"),
    others = refs.filter((ref) => ref.kind !== "original");
  const records = rows
    .filter((row) =>
      catalog?.recordings.some(
        (link) => link.file === row.file && link.song_id === song.id,
      ),
    )
    .sort((a, b) =>
      b.recorded_create_date.localeCompare(a.recorded_create_date),
    );
  const youtubeSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.game || ""} original soundtrack`)}`;
  const activeReference = refs.find(ref => active === `ref:${ref.id}`);
  const activeTake = records.find(row => active === row.file);
  const artworkReference = activeReference || originals[0] || refs[0];
  return (
    <section className={`song-content${songTab === "practice" ? " song-practice-page" : ""}`} id="songbook">
      <div ref={identityHeader} className={songTab === "practice" ? "practice-song-header" : undefined}>
      <EntityLink view="songs" navigate={navigate} className="back-link">
        <ArrowLeft size={16} /> All songs
      </EntityLink>
      <div className={songTab === "practice" ? "practice-song-identity" : undefined}>
      {songTab === "practice" && <SongThumbnail imageUrl={activeTake?.thumbnail} videoId={artworkReference ? artworkReference.youtube_id || youtubeId(artworkReference.url) : null} />}
      <PageHeader
        title={song.title}
        meta={[song.game, song.composer].filter(Boolean).join(" · ")}
      >
        {songTab === "overview" && <a
          className="quiet-button"
          href={youtubeSearch}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Headphones size={16} /> Find on YouTube <ArrowUpRight size={14} />
        </a>}
      </PageHeader>
      </div>
      {songTab === "overview" && <div className="song-summary">
        <span>
          {records.length} {records.length === 1 ? "take" : "takes"} ·{" "}
          {new Set(records.map((row) => row.session_id)).size}{" "}
          {new Set(records.map((row) => row.session_id)).size === 1
            ? "session"
            : "sessions"}
        </span>
        <MusicValues
          musicalKey={song.reference_key}
          bpm={song.reference_bpm}
          prefix="Reference "
        />
        {catalog?.repertoire.some((item) => item.song_id === song.id) && (
          <span className="membership">
            <Check size={14} /> In repertoire
          </span>
        )}
      </div>
      }<nav className="song-tabs" aria-label="Song views">
        <button aria-current={songTab === "practice" ? "page" : undefined} onClick={() => onTab?.("practice")}>Practice</button>
        <button aria-current={songTab === "overview" ? "page" : undefined} onClick={() => onTab?.("overview")}>Overview</button>
      </nav>
      </div>
      {songTab === "practice" ? practiceActive ? <div className="practice-main-host" ref={practiceHostRef} /> : <div className="practice-prepare">
        <SongThumbnail videoId={originals[0] ? originals[0].youtube_id || youtubeId(originals[0].url) : null} />
        <div><h2>Practice {song.title}</h2><p>Open a recording to work with its timeline, sections and instruments.</p>{(originals[0] || refs[0]) && <p className="quiet-note">{(originals[0] || refs[0]).label}</p>}
        {refs[0] ? <button onClick={() => props.prepareReference?.(originals[0] || refs[0])}><Headphones size={16} /> {originals.length ? "Open original" : "Open reference"}</button> : records[0] ? <button onClick={() => props.prepare?.(records[0])}><Headphones size={16} /> Open latest take</button> : <p>No recording is available yet.</p>}</div>
      </div> : <>
      {originals.length > 0 && (
        <section className="library-section">
          <h2>
            <Disc3 size={18} /> Original soundtrack
          </h2>
          <ul className="reference-list">
            {originals.map((ref) => (
              <ReferenceCard
                key={ref.id}
                refItem={ref}
                song={song}
                playReference={playReference}
                active={active}
              />
            ))}
          </ul>
        </section>
      )}
      <section className="library-section">
        <h2>
          <AudioLines size={18} /> Our takes <span>{records.length}</span>
        </h2>
        {records.length ? (
          <TakeList {...props} records={records} />
        ) : (
          <p className="quiet-note">No takes recorded yet.</p>
        )}
      </section>
      {others.length > 0 && (
        <section className="library-section">
          <h2>
            <Link2 size={18} /> Other versions & references
          </h2>
          <ul className="reference-list">
            {others.map((ref) => (
              <ReferenceCard
                key={ref.id}
                refItem={ref}
                song={song}
                playReference={playReference}
                active={active}
              />
            ))}
          </ul>
        </section>
      )}
      {(!song.reference_key || !song.reference_bpm) && (
        <p className="missing-metadata">
          Reference key and tempo can be recorded separately from each take.
          Unfilled values remain unknown.
        </p>
      )}
      <details className="song-identity">
        <summary>Song details</summary>
        <dl>
          <dt>Song ID</dt>
          <dd>{song.id}</dd>
          <dt>Reference key</dt>
          <dd>{song.reference_key || "Not recorded"}</dd>
          <dt>Reference BPM</dt>
          <dd>{song.reference_bpm ?? "Not recorded"}</dd>
          <dt>Composer</dt>
          <dd>{song.composer || "Not recorded"}</dd>
        </dl>
      </details>
      </>}
    </section>
  );
}
export function SongsPage({
  repertoire = false,
  ...props
}: LibraryProps & { repertoire?: boolean }) {
  const { catalog, rows, navigate } = props,
    [scope, setScope] = useState<"all" | "played" | "unplayed">("all");
  const songs = repertoire
    ? (catalog?.repertoire || []).flatMap(
        (item) => catalog?.songs.find((song) => song.id === item.song_id) || [],
      )
    : catalog?.songs || [];
  const visible = songs.filter((song) => {
    if (repertoire) return true;
    const played = rows.some((row) =>
      catalog?.recordings.some(
        (link) => link.song_id === song.id && link.file === row.file,
      ),
    );
    return scope === "all" || (scope === "played" ? played : !played);
  });
  const unknown = rows.filter(
    (row) =>
      !catalog?.recordings.find((link) => link.file === row.file)?.song_id,
  );
  return (
    <section className="library-browse" id="songbook">
      <PageHeader
        title={repertoire ? "Repertoire" : "Songs"}
        meta={
          repertoire
            ? "The songs we choose to work on"
            : `${songs.length} songs in the library`
        }
      />
      {!repertoire && (
        <div className="filter-bar">
          <FilterButtons
            label="Song filter"
            value={scope}
            onChange={setScope}
            options={[
              ["all", "All songs"],
              ["played", "Recorded"],
              ["unplayed", "No takes yet"],
            ]}
          />
        </div>
      )}
      {visible.length ? (
        <ul className="song-list">
          {visible.map((song) => (
            <SongRow
              {...props}
              key={song.id}
              song={song}
              note={
                repertoire
                  ? catalog?.repertoire.find((item) => item.song_id === song.id)
                      ?.note
                  : ""
              }
            />
          ))}
        </ul>
      ) : (
        <div className="catalog-empty">
          <ListMusic size={32} />
          <h2>
            {repertoire
              ? "No repertoire selected yet."
              : "No songs in this view."}
          </h2>
          <p>
            {repertoire
              ? "Recording history stays in the library. Repertoire is an explicit selection."
              : "Try All songs."}
          </p>
          {repertoire && (
            <EntityLink view="songs" navigate={navigate}>
              Browse the songbook <ArrowUpRight size={16} />
            </EntityLink>
          )}
        </div>
      )}
      {!repertoire && unknown.length > 0 && (
        <section className="library-section">
          <h2>
            Still to identify <span>{unknown.length}</span>
          </h2>
          <TakeList {...props} records={unknown} />
        </section>
      )}
    </section>
  );
}
export function SessionsPage({
  sessionId = "",
  ...props
}: LibraryProps & { sessionId?: string }) {
  const { catalog, rows, navigate } = props,
    session = catalog?.sessions.find((item) => item.id === sessionId);
  if (sessionId && !session)
    return (
      <>
        <PageHeader title="Session not found" />
        <EntityLink view="sessions" navigate={navigate}>
          All sessions
        </EntityLink>
      </>
    );
  if (session)
    return (
      <>
        <EntityLink view="sessions" navigate={navigate} className="back-link">
          <ArrowLeft size={16} /> All sessions
        </EntityLink>
        <TakesPage {...props} sessionId={sessionId} />
      </>
    );
  return (
    <>
      <PageHeader title="Sessions" meta="Rehearsals, by date" />
      <ul className="sessions-list">
        {catalog?.sessions.map((session) => {
          const records = rows.filter((row) => row.session_id === session.id);
          return (
            <li key={session.id}>
              <span className="session-icon">
                <CalendarDays size={23} />
              </span>
              <div>
                <EntityLink
                  view="sessions"
                  session={session.id}
                  navigate={navigate}
                >
                  {date(session.date)}
                </EntityLink>
                <small>
                  {session.label.replace(/^\d{4}-\d{2}-\d{2}\s*/, "")}
                </small>
              </div>
              <span>
                {records.length} takes ·{" "}
                {formatTime(
                  records.reduce(
                    (sum, row) => sum + Number(row.duration_seconds),
                    0,
                  ),
                )}
              </span>
              <ArrowUpRight size={17} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
export function TakesPage({
  sessionId = "",
  ...props
}: LibraryProps & { sessionId?: string }) {
  const { rows, catalog, navigate } = props,
    [media, setMedia] = useState<MediaFilter>("all"),
    [sort, setSort] = useState<SortKey>("take"),
    [ascending, setAscending] = useState(false),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState(new Set<string>()),
    [message, setMessage] = useState("");
  const records = filterRows(
      rows,
      "",
      media,
      sessionId || "all",
      sort,
      ascending,
    ),
    session = catalog?.sessions.find((item) => item.id === sessionId);
  const selectedRecords = records.filter((row) => selected.has(row.file));
  function download() {
    for (const row of selectedRecords) {
      const a = document.createElement("a");
      a.href = driveDownload(row.video_file_id || row.audio_file_id);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.append(a);
      a.click();
      a.remove();
    }
    setMessage(
      "Downloads requested. Individual source links remain available in the player.",
    );
  }
  return (
    <section className="ledger" id="recordings" tabIndex={-1}>
      <PageHeader
        title={session ? date(session.date) : "Takes"}
        meta={
          session
            ? session.label.replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
            : "Our rehearsal archive"
        }
      >
        <a className="quiet-button" href="data/recordings.csv" download>
          <Download size={15} /> Export CSV
        </a>
        <button
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setSelected(new Set());
            setMessage("");
          }}
        >
          {selecting ? "Done" : "Select"}
        </button>
      </PageHeader>
      <div className="filter-bar">
        <FilterButtons
          label="Media filter"
          value={media}
          onChange={setMedia}
          options={[
            ["all", "Any media"],
            ["video", "Has video"],
            ["audio", "Has audio"],
            ["audio-only", "Audio only"],
          ]}
        />
        <span className="filter-count" role="status">
          {records.length} takes ·{" "}
          {formatTime(
            records.reduce((sum, row) => sum + Number(row.duration_seconds), 0),
          )}
        </span>
      </div>
      {selecting && (
        <div className="selection-toolbar">
          <span>{selectedRecords.length} selected</span>
          <button
            onClick={() =>
              setSelected(
                selectedRecords.length === records.length
                  ? new Set()
                  : new Set(records.map((row) => row.file)),
              )
            }
          >
            {selectedRecords.length === records.length && records.length
              ? "Clear selection"
              : "Select all shown"}
          </button>
          <button disabled={!selectedRecords.length} onClick={download}>
            Download selected
          </button>
          {message && <p role="status">{message}</p>}
        </div>
      )}
      {!records.length && (
        <div className="empty-state">
          <h2>No matching takes</h2>
          <button onClick={() => setMedia("all")}>Show all media</button>
        </div>
      )}
      {groups(records).map(([id, takes]) => {
        const groupedSession = catalog?.sessions.find((item) => item.id === id);
        const sessionName = (groupedSession?.label || takes[0].session_label || "")
          .replace(/^\d{4}-\d{2}-\d{2}\s*/, "");
        return (
        <section className="session-group" key={id}>
          <header className="session-band">
            <EntityLink view="sessions" session={id} navigate={navigate} className="session-band-identity">
              <span>{date(groupedSession?.date || takes[0].recorded_create_date)}</span>
              {sessionName && <span className="session-band-name">{sessionName}</span>}
            </EntityLink>
            <span>{takes.length} takes</span>
            {takes[0].youtube_playlist_url && (
              <a
                href={takes[0].youtube_playlist_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Playlist <ArrowUpRight size={13} />
              </a>
            )}
          </header>
          <div className="ledger-headings">
            {(
              [
                ["take", "Take"],
                ["recording", "Song"],
                ["time", "Time"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={sort === key}
                aria-label={`Sort by ${label}`}
                onClick={() => {
                  setAscending(sort === key ? !ascending : key === "recording");
                  setSort(key);
                }}
              >
                {label}
                {sort === key ? (ascending ? " ↑" : " ↓") : ""}
              </button>
            ))}
          </div>
          <TakeList
            {...props}
            records={takes}
            selection={
              selecting
                ? {
                    files: selected,
                    toggle: (file) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        next.has(file) ? next.delete(file) : next.add(file);
                        return next;
                      }),
                  }
                : undefined
            }
          />
        </section>
      );})}
    </section>
  );
}
export function SearchPage({ ...props }: LibraryProps) {
  const { catalog, rows, query = "", navigate } = props,
    [scope, setScope] = useState<"all" | "songs" | "takes" | "sessions">("all");
  const result = searchLibrary(catalog, rows, query),
    count = result.songs.length + result.takes.length + result.sessions.length;
  const shown = scope === "all" ? count : result[scope].length;
  return (
    <section className="search-results">
      <PageHeader title="Search" meta={`${count} results for “${query}”`} />
      <div className="filter-bar">
        <FilterButtons
          label="Search scope"
          value={scope}
          onChange={setScope}
          options={[
            ["all", `All ${count}`],
            ["songs", `Songs ${result.songs.length}`],
            ["takes", `Takes ${result.takes.length}`],
            ["sessions", `Sessions ${result.sessions.length}`],
          ]}
        />
        <span className="sr-only" role="status">
          {count} results
        </span>
      </div>
      {!shown && (
        <div className="empty-state">
          <h2>
            {scope === "all"
              ? "No matching songs, takes or sessions"
              : `No matching ${scope}`}
          </h2>
          <p>Try a song, game, date, filename or performer.</p>
        </div>
      )}
      {["all", "songs"].includes(scope) && result.songs.length > 0 && (
        <section className="library-section">
          <h2>
            <FileMusic size={17} /> Songs <span>{result.songs.length}</span>
          </h2>
          <ul className="song-list">
            {result.songs.map(({ song, context }) => (
              <SongRow {...props} key={song.id} song={song} context={context} />
            ))}
          </ul>
        </section>
      )}
      {["all", "takes"].includes(scope) && result.takes.length > 0 && (
        <section className="library-section">
          <h2>
            <AudioLines size={17} /> Our takes{" "}
            <span>{result.takes.length}</span>
          </h2>
          <TakeList
            {...props}
            records={result.takes.map((item) => item.row)}
            contextByFile={
              new Map(result.takes.map((item) => [item.row.file, item.context]))
            }
          />
        </section>
      )}
      {["all", "sessions"].includes(scope) && result.sessions.length > 0 && (
        <section className="library-section">
          <h2>
            <CalendarDays size={17} /> Sessions
          </h2>
          <ul className="search-session-list">
            {result.sessions.map(({ session, context }) => (
              <li key={session.id}>
                <EntityLink
                  view="sessions"
                  session={session.id}
                  navigate={navigate}
                >
                  <Highlight value={session.label} query={query} />
                </EntityLink>
                {!session.label
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()) && (
                  <small>
                    <Highlight value={context} query={query} />
                  </small>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function SongThumbnail({ videoId, imageUrl }: { videoId?: string | null; imageUrl?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = imageUrl || (videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : "");
  return <span className="song-monogram song-thumbnail" aria-hidden="true">{source && source !== failedSource ? <img src={source} alt="" loading="lazy" onError={() => setFailedSource(source)} /> : <FileMusic size={21} />}</span>;
}
