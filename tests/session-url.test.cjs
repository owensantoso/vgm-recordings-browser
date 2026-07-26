const test = require("node:test");
const assert = require("node:assert/strict");
const { pathForFile, pathForSession, sessionFromHref, validSession } = require("../session-url.js");

const base = "https://example.test/archive/?session=july#IMG_5944";

test("reads a session or falls back to all", () => {
  assert.equal(sessionFromHref(base), "july");
  assert.equal(sessionFromHref("https://example.test/archive/#IMG_5944"), "all");
});

test("validates requested sessions against available values", () => {
  assert.equal(validSession("july", ["may", "july"]), "july");
  assert.equal(validSession("missing", ["may", "july"]), "all");
});

test("updates or removes the session while preserving the recording hash", () => {
  assert.equal(pathForSession(base, "may"), "/archive/?session=may#IMG_5944");
  assert.equal(pathForSession(base, "all"), "/archive/#IMG_5944");
});

test("updates the recording hash while preserving the session", () => {
  assert.equal(pathForFile(base, "IMG_5934"), "/archive/?session=july#IMG_5934");
});
