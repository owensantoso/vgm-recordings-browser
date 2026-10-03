import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCsv,
  filterRows,
  bounds,
  fileFromHash,
  hashForFile,
} from "../src/recordings.ts";
const rows = parseCsv(
  readFileSync(new URL("../data/recordings.csv", import.meta.url), "utf8"),
);
test("the canonical archive retains all 22 takes across both sessions", () => {
  assert.equal(rows.length, 22);
  assert.equal(
    rows.filter((r) => r.session_id.startsWith("2026-05")).length,
    13,
  );
  assert.equal(
    rows.filter((r) => r.session_id.startsWith("2026-07")).length,
    9,
  );
  assert.equal(
    rows.find((r) => r.file.startsWith("IMG_5940"))?.caption,
    "Dire, Dire Docks",
  );
});
test("CSV preserves escaped quotes and embedded line breaks, rejects truncated quotes", () => {
  assert.equal(
    parseCsv('file,caption\r\na,"one\n""two"""\r\n')[0].caption,
    'one\n"two"',
  );
  assert.throws(() => parseCsv('file,caption\na,"bad'));
});
test("filtering includes hidden metadata and audio-only takes", () => {
  assert.equal(
    filterRows(rows, "iPhone 17", "all", "all", "take", false).length,
    9,
  );
  assert.equal(
    filterRows(rows, "", "audio-only", "all", "take", false).length,
    1,
  );
  assert.equal(
    filterRows(rows, "You Will", "all", "all", "take", true).length,
    2,
  );
  const sorted = filterRows(rows, "", "all", "all", "time", true);
  assert.equal(sorted[0].file, "IMG_7795.MOV");
});
test("full filenames with spaces and old exact stem links remain addressable", () => {
  for (const row of rows)
    assert.equal(fileFromHash("#" + hashForFile(row.file), rows), row.file);
  assert.equal(fileFromHash("#IMG_7796", rows), "IMG_7796.MOV");
  assert.equal(fileFromHash("#%E0%A4%A", rows), "");
});
test("Beneath the Mask preserves its section and full recording bounds", () => {
  assert.deepEqual(bounds(rows.find((r) => r.file === "IMG_7796.MOV")!), {
    start: 158,
    end: 573,
    full: 587.6,
    duration: 415,
  });
});
