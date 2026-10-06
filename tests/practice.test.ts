import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLoopRange,
  parsePracticeTarget,
  makePracticeLink,
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
