export interface Recording {
  file: string;
  caption: string;
  length: string;
  duration_seconds: string;
  size_mb: string;
  resolution: string;
  rotation: string;
  recorded_create_date: string;
  download_modified: string;
  device: string;
  video_file_id: string;
  video_url: string;
  audio_file: string;
  audio_path?: string;
  audio_format: string;
  audio_size_mb: string;
  audio_file_id: string;
  audio_url: string;
  has_video: string;
  has_audio: string;
  thumbnail: string;
  session_id: string;
  session_label: string;
  tags: string;
  youtube_playlist_id: string;
  youtube_playlist_url: string;
  youtube_video_id: string;
  youtube_url: string;
  youtube_timestamp_url: string;
  drums: string;
  piano: string;
  guitar: string;
  bass: string;
  song_name: string;
  franchise: string;
  game_title: string;
  section_start: string;
  section_end: string;
}
export type MediaFilter = "all" | "video" | "audio" | "audio-only";
export type SortKey = "take" | "recording" | "time";
export const searchFields = [
  "caption",
  "song_name",
  "game_title",
  "franchise",
  "file",
  "drums",
  "piano",
  "guitar",
  "bass",
  "device",
  "session_label",
  "session_id",
  "tags",
] as const;
const fields: (keyof Recording)[] = [
  ...searchFields,
  "length",
  "duration_seconds",
  "size_mb",
  "resolution",
  "rotation",
  "recorded_create_date",
  "download_modified",
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
  "youtube_playlist_id",
  "youtube_playlist_url",
  "youtube_video_id",
  "youtube_url",
  "youtube_timestamp_url",
  "section_start",
  "section_end",
];

export function parseCsv(text: string): Recording[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i],
      next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted)
    throw new Error("The recording CSV contains an unfinished quoted field.");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [rawHeaders, ...body] = rows;
  const headers = rawHeaders?.map((header) => header.replace(/^\uFEFF/, ""));
  if (!headers?.includes("file"))
    throw new Error("The recording CSV is missing its file column.");
  const seen = new Set<string>();
  return body.map((cells) => {
    const values = Object.fromEntries(
      headers.map((h, i) => [h.replace(/^\uFEFF/, ""), cells[i] || ""]),
    );
    const record = Object.fromEntries(
      fields.map((key) => [key, values[key] || ""]),
    ) as unknown as Recording;
    if (!record.file || seen.has(record.file))
      throw new Error(
        "The recording CSV contains missing or duplicate file names.",
      );
    seen.add(record.file);
    return record;
  });
}
export function seconds(value: string): number {
  const parts = value.split(":").map(Number);
  return parts.every((n) => Number.isFinite(n) && n >= 0)
    ? parts.reduce((sum, n) => sum * 60 + n, 0)
    : 0;
}
export function bounds(row: Recording) {
  const full = Math.max(0, Number(row.duration_seconds) || 0);
  let start = seconds(row.section_start);
  if (!start && row.youtube_timestamp_url) {
    try {
      const url = new URL(row.youtube_timestamp_url);
      const t =
        url.searchParams.get("t") || url.searchParams.get("start") || "";
      const match = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      start = /^\d+$/.test(t)
        ? Number(t)
        : match
          ? Number(match[1] || 0) * 3600 +
            Number(match[2] || 0) * 60 +
            Number(match[3] || 0)
          : 0;
    } catch {
      /* Invalid source timestamps fall back to the start. */
    }
  }
  start = Math.min(full, start);
  const explicit = seconds(row.section_end);
  const end = explicit > start ? Math.min(full, explicit) : full;
  return { start, end, full, duration: end - start };
}
export function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60),
    s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
export function title(row: Recording) {
  return row.caption && !row.caption.includes("no embedded caption")
    ? row.caption
    : row.song_name || "Untitled recording";
}
export function filterRows(
  rows: Recording[],
  query: string,
  media: MediaFilter,
  session: string,
  sort: SortKey,
  ascending: boolean,
) {
  const needle = query.trim().toLocaleLowerCase();
  return rows
    .filter(
      (row) =>
        (session === "all" || row.session_id === session) &&
        (media === "all" ||
          (media === "video" && row.has_video === "yes") ||
          (media === "audio" && row.has_audio === "yes") ||
          (media === "audio-only" &&
            row.has_audio === "yes" &&
            row.has_video !== "yes")) &&
        (!needle ||
          searchFields.some((key) =>
            row[key].toLocaleLowerCase().includes(needle),
          )),
    )
    .sort(
      (a, b) =>
        (ascending ? 1 : -1) *
        ((sort === "time"
          ? Number(a.duration_seconds) - Number(b.duration_seconds)
          : sort === "recording"
            ? title(a).localeCompare(title(b))
            : a.recorded_create_date.localeCompare(b.recorded_create_date)) ||
          a.file.localeCompare(b.file)),
    );
}
export function groups(rows: Recording[]) {
  const map = new Map<string, Recording[]>();
  rows.forEach((row) =>
    map.set(row.session_id, [...(map.get(row.session_id) || []), row]),
  );
  return [...map].sort(([a], [b]) => b.localeCompare(a));
}
export function hashForFile(file: string) {
  return encodeURIComponent(file.replace(/\.[^.]+$/, ""));
}
export function fileFromHash(hash: string, rows: Recording[]) {
  try {
    const value = decodeURIComponent(hash.replace(/^#/, "")).toLowerCase();
    return (
      rows.find(
        (row) =>
          row.file.toLowerCase() === value ||
          row.file.replace(/\.[^.]+$/, "").toLowerCase() === value,
      )?.file || ""
    );
  } catch {
    return "";
  }
}
export function sessionFromHref(href: string) {
  return new URL(href).searchParams.get("session") || "all";
}
export function validSession(requested: string, values: string[]) {
  return values.includes(requested) ? requested : "all";
}
export function pathForSession(href: string, session: string) {
  const url = new URL(href);
  if (session === "all" || !session) url.searchParams.delete("session");
  else url.searchParams.set("session", session);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function pathForFile(href: string, hash: string) {
  const url = new URL(href);
  url.hash = hash;
  return `${url.pathname}${url.search}${url.hash}`;
}
export function reconcileSelection(
  files: string[],
  file: string,
  hasHash: boolean,
) {
  const selectedFile = files.includes(file) ? file : files[0] || "";
  return {
    selectedFile,
    syncHash: Boolean(hasHash && selectedFile && selectedFile !== file),
  };
}
export function driveDownload(id: string) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}
export function videoLink(row: Recording) {
  return (
    row.youtube_timestamp_url ||
    row.youtube_url ||
    (row.youtube_video_id
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(row.youtube_video_id)}`
      : row.video_url)
  );
}
export const sessionDriveUrls: Record<string, string> = {
  "2026-05-31-shimokitazawa-first-vgm-session":
    "https://drive.google.com/drive/folders/1_bHbtwZ_gi2YkmWzd1F76JjwmVpvKHrM?usp=drive_link",
  "2026-07-26-shimokitazawa-vgm-session":
    "https://drive.google.com/drive/folders/1jtvUIW6-4IStpwJ9aDTOXFd23nEjr6U-?usp=drive_link",
};
