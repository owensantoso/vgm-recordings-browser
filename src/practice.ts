export interface LoopRange {
  start: number;
  end: number;
}
export interface PracticeTarget {
  range: LoopRange | null;
  repeat: boolean;
  error: string;
  sectionId?: string;
}

export function validateLoopRange(range: LoopRange, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0)
    return "The audio duration is not available yet.";
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end))
    return "Enter a number for both A and B.";
  if (range.start < 0 || range.end < 0)
    return "A and B must be at or after zero.";
  if (range.end <= range.start) return "B must come after A.";
  if (range.start > duration || range.end > duration)
    return "Keep A and B within this recording.";
  if (range.end < range.start + 0.25)
    return "Choose a range of at least 0.25 seconds.";
  return "";
}

function validSourceId(sourceId: string): boolean {
  return Boolean(sourceId.trim()) && !/[\u0000-\u001f\u007f]/.test(sourceId);
}

export function parsePracticeTarget(
  href: string,
  sourceId: string,
  duration: number,
  sections?: readonly { id: string; start: number; end: number }[],
): PracticeTarget {
  const empty: PracticeTarget = { range: null, repeat: false, error: "" };
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { ...empty, error: "This practice link is not a valid address." };
  }
  const hasRange = url.searchParams.has("t"),
    hasRepeat = url.searchParams.has("repeat"),
    hasSection = url.searchParams.has("section");
  if (!hasRange && !hasRepeat && !hasSection) return empty;
  if (
    !validSourceId(sourceId) ||
    url.searchParams.getAll("play").length !== 1 ||
    url.searchParams.get("play") !== sourceId
  ) {
    return {
      ...empty,
      error:
        "This practice link belongs to a different recording. Choose its recording first.",
    };
  }
  if (
    url.searchParams.getAll("t").length > 1 ||
    url.searchParams.getAll("repeat").length > 1 ||
    url.searchParams.getAll("section").length > 1 ||
    (hasSection && hasRange)
  ) {
    return {
      ...empty,
      error: "This practice link has conflicting range settings.",
    };
  }
  if (hasRepeat && url.searchParams.get("repeat") !== "1")
    return {
      ...empty,
      error: "This practice link has an invalid Repeat setting.",
    };
  if (hasSection) {
    const id = url.searchParams.get("section") || "";
    const section = sections?.find(value => value.id === id);
    if (!section) return { ...empty, error: "This section is not available for the linked source. Reload sections or choose a range." };
    const range = { start: section.start, end: section.end };
    const error = validateLoopRange(range, duration);
    return error ? { ...empty, error } : { range, repeat: hasRepeat, error: "", sectionId: id };
  }
  if (!hasRange)
    return {
      ...empty,
      error: "Repeat needs an A–B range in this practice link.",
    };
  const parts = (url.searchParams.get("t") || "").split(",");
  const numeric = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
  if (parts.length !== 2 || parts.some((value) => !numeric.test(value)))
    return {
      ...empty,
      error: "This practice link needs two times: A and B in seconds.",
    };
  const range = { start: Number(parts[0]), end: Number(parts[1]) };
  const error = validateLoopRange(range, duration);
  return error ? { ...empty, error } : { range, repeat: hasRepeat, error: "" };
}

export function makePracticeLink(
  href: string,
  sourceId: string,
  range: LoopRange,
  repeat: boolean,
): string {
  if (!validSourceId(sourceId))
    throw new Error("Choose a recording before copying a practice link.");
  const error = validateLoopRange(range, range.end);
  if (error) throw new Error(error);
  const url = new URL(href);
  url.searchParams.set("play", sourceId);
  url.searchParams.delete("section");
  url.searchParams.set(
    "t",
    `${Object.is(range.start, -0) ? 0 : range.start},${range.end}`,
  );
  if (repeat) url.searchParams.set("repeat", "1");
  else url.searchParams.delete("repeat");
  url.hash = "";
  return url.toString();
}

export function makeSectionLink(href: string, sourceId: string, sectionId: string, repeat: boolean): string {
  if (!validSourceId(sourceId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sectionId))
    throw new Error("Choose a saved section before copying its link.");
  const url = new URL(href);
  url.searchParams.set("play", sourceId);
  url.searchParams.set("section", sectionId);
  url.searchParams.delete("t");
  if (repeat) url.searchParams.set("repeat", "1");
  else url.searchParams.delete("repeat");
  url.hash = "";
  return url.toString();
}
