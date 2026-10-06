import type { CatalogData, Song, SongReference } from "./Catalog";
import type { Recording } from "./recordings";
import { title, searchFields } from "./recordings";
export function youtubeId(href: string): string | null {
  try {
    const url = new URL(href),
      host = url.hostname.replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : ["youtube.com", "music.youtube.com"].includes(host)
          ? url.searchParams.get("v") ||
            (url.pathname.startsWith("/embed/") ? url.pathname.slice(7) : "")
          : "";
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
export function referenceRow(ref: SongReference, song: Song): Recording {
  // Provider rendering adapter, never a persisted rehearsal record.
  return {
    file: `ref:${ref.id}`,
    caption: song.title,
    song_name: song.title,
    game_title: song.game || "",
    franchise: song.franchise || "",
    youtube_video_id: ref.youtube_id || youtubeId(ref.url) || "",
    youtube_url: ref.url,
    has_video: "yes",
    has_audio: "no",
    duration_seconds: "0",
    thumbnail: "",
    section_start: "",
    section_end: "",
  } as Recording;
}
export function searchLibrary(
  catalog: CatalogData | null,
  rows: Recording[],
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { songs: [], takes: [], sessions: [] };
  const match = (values: (string | null | undefined)[]) =>
    values.find((value) => value?.toLocaleLowerCase().includes(needle)) || "";
  const songs = (catalog?.songs || []).flatMap((song) => {
    const context = match([
      song.title,
      song.game,
      song.franchise,
      song.composer,
      song.reference_key,
      song.reference_bpm?.toString(),
      ...(catalog?.references
        .filter((ref) => ref.song_id === song.id)
        .flatMap((ref) => [ref.label, ref.artist]) || []),
    ]);
    return context ? [{ song, context }] : [];
  });
  const takes = rows.flatMap((row) => {
    const song = catalog?.songs.find(
      (song) =>
        song.id ===
        catalog.recordings.find((link) => link.file === row.file)?.song_id,
    );
    const meta = catalog?.recordings.find((link) => link.file === row.file);
    const context = match([
      title(row),
      song?.title,
      ...searchFields.map((field) => row[field]),
      meta?.played_key,
      meta?.played_bpm?.toString(),
    ]);
    return context ? [{ row, context }] : [];
  });
  const sessions = (catalog?.sessions || []).flatMap((session) => {
    const context = match([session.label, session.date]);
    return context ? [{ session, context }] : [];
  });
  return { songs, takes, sessions };
}
