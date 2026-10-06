import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLoopRange,
  parsePracticeTarget,
  makePracticeLink,
  makeSectionLink,
} from "../src/practice.ts";

const base =
  "https://example.test/vgm/?view=songs&song=vgm-example&session=2026-05-31&layout=dock#OLD_0001";
const source = "ref:example-original";

test("practice ranges accept fractional boundaries and exact minimum duration", () => {
  assert.equal(validateLoopRange({ start: 0, end: 0.25 }, 10), "");
  assert.equal(validateLoopRange({ start: 0.1, end: 0.35 }, 10), "");
  assert.equal(validateLoopRange({ start: 1.234567, end: 9.876543 }, 10), "");
  assert.equal(validateLoopRange({ start: 9.75, end: 10 }, 10), "");
});
test("practice ranges reject nonfinite, negative, reversed, too-short and out-of-source values", () => {
  for (const duration of [0, -1, NaN, Infinity])
    assert.notEqual(validateLoopRange({ start: 0, end: 1 }, duration), "");
  for (const range of [
    { start: NaN, end: 1 },
    { start: 0, end: Infinity },
    { start: -1, end: 1 },
    { start: 0, end: -1 },
    { start: 1, end: 1 },
    { start: 2, end: 1 },
    { start: 1, end: 1.249999 },
    { start: 0.1, end: 0.349999999999 },
    { start: 9, end: 11 },
    { start: 11, end: 12 },
  ])
    assert.notEqual(validateLoopRange(range, 10), "");
});
test("canonical practice links preserve browse context and exact fractional source times", () => {
  const range = { start: 1.234567, end: 8.7654321 };
  const href = makePracticeLink(base, source, range, true),
    url = new URL(href);
  assert.equal(url.searchParams.get("view"), "songs");
  assert.equal(url.searchParams.get("song"), "vgm-example");
  assert.equal(url.searchParams.get("session"), "2026-05-31");
  assert.equal(url.searchParams.get("layout"), "dock");
  assert.equal(url.searchParams.get("play"), source);
  assert.equal(url.searchParams.get("t"), "1.234567,8.7654321");
  assert.equal(url.hash, "");
  assert.deepEqual(parsePracticeTarget(href, source, 10), {
    range,
    repeat: true,
    error: "",
  });
  assert.equal(
    makePracticeLink(href, source, range, true),
    href,
    "serialization is idempotent",
  );
  const ordinary = makePracticeLink(href, source, range, false);
  assert.equal(new URL(ordinary).searchParams.has("repeat"), false);
  assert.deepEqual(parsePracticeTarget(ordinary, source, 10), {
    range,
    repeat: false,
    error: "",
  });
});
test("small fractional numbers, signed zero and filenames survive canonical round trips", () => {
  const range = { start: 1e-7, end: 0.5 };
  const file = "IMG_5934 Persona take.MOV";
  const href = makePracticeLink(base, file, range, false);
  assert.deepEqual(parsePracticeTarget(href, file, 1), {
    range,
    repeat: false,
    error: "",
  });
  assert.equal(
    new URL(
      makePracticeLink(base, file, { start: -0, end: 1 }, false),
    ).searchParams.get("t"),
    "0,1",
  );
});
test("no practice target does not infer a range or enable repeat", () => {
  assert.deepEqual(parsePracticeTarget(base, source, NaN), {
    range: null,
    repeat: false,
    error: "",
  });
});
test("practice links require exact source identity without another media fallback", () => {
  const href = makePracticeLink(base, source, { start: 1, end: 2 }, true);
  for (const identity of ["ref:another-original", "IMG_0001.MOV", "", " "]) {
    const target = parsePracticeTarget(href, identity, 10);
    assert.equal(target.range, null);
    assert.equal(target.repeat, false);
    assert.match(target.error, /different recording/);
  }
  const url = new URL(href);
  url.searchParams.delete("play");
  assert.match(
    parsePracticeTarget(url.toString(), source, 10).error,
    /different recording/,
  );
  url.searchParams.append("play", source);
  url.searchParams.append("play", "other");
  assert.match(
    parsePracticeTarget(url.toString(), source, 10).error,
    /different recording/,
  );
});
test("malformed or conflicting time and repeat settings fail visibly", () => {
  const href = makePracticeLink(base, source, { start: 1, end: 2 }, true);
  for (const value of [
    "",
    "1",
    "1,2,3",
    "1,,2",
    "one,two",
    "0x10,20",
    "1,Infinity",
    " 1,2",
    "2,1",
    "-1,2",
    "1,1.1",
    "1,11",
    "1e999,2",
  ]) {
    const url = new URL(href);
    url.searchParams.set("t", value);
    const target = parsePracticeTarget(url.toString(), source, 10);
    assert.equal(target.range, null, value);
    assert.equal(target.repeat, false, value);
    assert.ok(target.error, value);
  }
  const duplicate = new URL(href);
  duplicate.searchParams.append("t", "3,4");
  assert.match(
    parsePracticeTarget(duplicate.toString(), source, 10).error,
    /conflicting/,
  );
  const repeatOnly = new URL(href);
  repeatOnly.searchParams.delete("t");
  assert.match(
    parsePracticeTarget(repeatOnly.toString(), source, 10).error,
    /needs an A–B range/,
  );
  for (const value of ["", "0", "true", "yes"]) {
    const url = new URL(href);
    url.searchParams.set("repeat", value);
    assert.match(
      parsePracticeTarget(url.toString(), source, 10).error,
      /Repeat setting/,
    );
  }
  const repeats = new URL(href);
  repeats.searchParams.append("repeat", "1");
  assert.match(
    parsePracticeTarget(repeats.toString(), source, 10).error,
    /conflicting/,
  );
  assert.ok(parsePracticeTarget("not a URL", source, 10).error);
});
test("practice link creation rejects invalid source IDs and invalid intrinsic ranges", () => {
  for (const id of ["", " ", "bad\u0000id"])
    assert.throws(() =>
      makePracticeLink(base, id, { start: 0, end: 1 }, false),
    );
  for (const range of [
    { start: -1, end: 1 },
    { start: 0, end: Infinity },
    { start: 2, end: 1 },
    { start: 0, end: 0.1 },
  ])
    assert.throws(() => makePracticeLink(base, source, range, true));
});


const sectionId = "bc35051c-f639-4d55-a436-7c0cf76aaf83";
const savedSection = { id: sectionId, label: "Verse", start: 30.125, end: 42.875, revision: 1 };

test("saved section links resolve exact source, fractional bounds and optional Repeat", () => {
  for (const repeat of [true, false]) {
    const href = makeSectionLink(base, source, sectionId, repeat);
    assert.deepEqual(parsePracticeTarget(href, source, 100, [savedSection]), {
      range: { start: savedSection.start, end: savedSection.end },
      repeat,
      error: "",
      sectionId,
    });
    const wrong = parsePracticeTarget(href, "ref:another-original", 100, [savedSection]);
    assert.equal(wrong.range, null);
    assert.equal(wrong.repeat, false);
    assert.equal(wrong.sectionId, undefined);
    assert.match(wrong.error, /different recording/);
  }
});

test("unresolved and conflicting section targets never fall back to manual timestamps", () => {
  const href = makeSectionLink(base, source, sectionId, true);
  for (const sections of [undefined, []]) {
    const target = parsePracticeTarget(href, source, 100, sections);
    assert.equal(target.range, null);
    assert.equal(target.repeat, false);
    assert.equal(target.sectionId, undefined);
    assert.match(target.error, /not available/);
  }
  for (const mutate of [
    (url: URL) => url.searchParams.set("t", "1,2"),
    (url: URL) => url.searchParams.append("section", sectionId),
    (url: URL) => url.searchParams.append("repeat", "1"),
  ]) {
    const url = new URL(href); mutate(url);
    const target = parsePracticeTarget(url.toString(), source, 100, [savedSection]);
    assert.equal(target.range, null);
    assert.equal(target.repeat, false);
    assert.match(target.error, /conflicting/);
  }
  const unknown = new URL(href); unknown.searchParams.set("section", "00000000-0000-4000-8000-000000000001");
  assert.match(parsePracticeTarget(unknown.toString(), source, 100, [savedSection]).error, /not available/);
  const badRepeat = new URL(href); badRepeat.searchParams.set("repeat", "true");
  assert.match(parsePracticeTarget(badRepeat.toString(), source, 100, [savedSection]).error, /Repeat setting/);
  const missingSource = new URL(href); missingSource.searchParams.delete("play");
  assert.match(parsePracticeTarget(missingSource.toString(), source, 100, [savedSection]).error, /different recording/);
});

test("semantic and manual links replace each other while preserving browsing context", () => {
  const manual = makePracticeLink(base, source, { start: 1.125, end: 2.75 }, true);
  const context = new URL(manual); context.searchParams.set("q", "Mask & piano");
  const semantic = makeSectionLink(context.toString(), source, sectionId, false);
  const url = new URL(semantic);
  assert.equal(url.searchParams.has("t"), false);
  assert.equal(url.searchParams.has("repeat"), false);
  assert.equal(url.searchParams.get("section"), sectionId);
  for (const key of ["view", "song", "session", "layout", "q"]) assert.equal(url.searchParams.get(key), context.searchParams.get(key));
  assert.equal(url.hash, "");
  assert.equal(makeSectionLink(semantic, source, sectionId, false), semantic);
  const timed = new URL(makePracticeLink(semantic, source, { start: 2.125, end: 8.75 }, true));
  assert.equal(timed.searchParams.has("section"), false);
  assert.equal(timed.searchParams.get("t"), "2.125,8.75");
  assert.equal(timed.searchParams.get("repeat"), "1");
  for (const key of ["view", "song", "session", "layout", "q"]) assert.equal(timed.searchParams.get(key), context.searchParams.get(key));
});

test("renaming retains section links, changed bounds resolve by the same UUID and invalid saved bounds fail", () => {
  const href = makeSectionLink(base, source, sectionId, true);
  const renamed = { ...savedSection, label: "Verse 1", revision: 2 };
  assert.deepEqual(parsePracticeTarget(href, source, 100, [renamed]), parsePracticeTarget(href, source, 100, [savedSection]));
  const retimed = { ...renamed, start: 33.25, end: 40.5, revision: 3 };
  assert.deepEqual(parsePracticeTarget(href, source, 100, [retimed]), { range: { start: 33.25, end: 40.5 }, repeat: true, error: "", sectionId });
  for (const bounds of [
    { start: -1, end: 40 }, { start: 40, end: 30 }, { start: 1, end: 1.249 },
    { start: 30, end: 101 }, { start: NaN, end: 40 }, { start: 30, end: Infinity },
  ]) {
    const target = parsePracticeTarget(href, source, 100, [{ ...savedSection, ...bounds }]);
    assert.equal(target.range, null);
    assert.equal(target.repeat, false);
    assert.equal(target.sectionId, undefined);
    assert.ok(target.error);
  }
});

test("saved link creation rejects missing/invalid UUIDs or source identities", () => {
  for (const id of ["", "Verse", "../section", "00000000-0000-0000-0000-000000000000", sectionId + "extra"]) assert.throws(() => makeSectionLink(base, source, id, true));
  for (const id of ["", " ", "bad\u0000source"]) assert.throws(() => makeSectionLink(base, id, sectionId, true));
});
