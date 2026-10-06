export type View =
  | "recordings"
  | "songs"
  | "repertoire"
  | "sessions"
  | "search";
export interface Song {
  id: string;
  title: string;
  game: string | null;
  franchise: string | null;
  composer: string | null;
  reference_key?: string | null;
  reference_bpm?: number | null;
}
export interface SongReference {
  id: string;
  song_id: string;
  kind: string;
  label: string;
  url: string;
  artist: string | null;
  youtube_id?: string | null;
}
export interface CatalogData {
  version: number;
  songs: Song[];
  sessions: { id: string; label: string; date: string }[];
  recordings: {
    file: string;
    session_id: string;
    song_id: string | null;
    played_key?: string | null;
    played_bpm?: number | null;
  }[];
  references: SongReference[];
  repertoire: { song_id: string; note: string; position: number }[];
}
export interface Route {
  view: View;
  song: string;
  session: string;
  q: string;
}
export function route(href: string): Route {
  const url = new URL(href),
    value = url.searchParams.get("view");
  const session = url.searchParams.get("session") || "";
  const view: View = [
    "recordings",
    "songs",
    "repertoire",
    "sessions",
    "search",
  ].includes(value || "")
    ? (value as View)
    : session
      ? "sessions"
      : url.hash
        ? "recordings"
        : "songs";
  return {
    view,
    song: url.searchParams.get("song") || "",
    session: session === "all" ? "" : session,
    q: view === "search" ? url.searchParams.get("q") || "" : "",
  };
}
export function catalogHref(
  href: string,
  view: View,
  song = "",
  session = "",
  q = "",
) {
  const url = new URL(href);
  url.searchParams.set("view", view);
  for (const [key, value] of [
    ["song", song],
    ["session", session],
    ["q", q],
  ])
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  return url.toString();
}
