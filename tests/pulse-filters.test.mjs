import { test } from "node:test";
import { strict as assert } from "node:assert";
import { hasVoted, matchesPulse, pulseCounts } from "../pulse-filters.mjs";

const now = Date.parse("2026-11-12T12:00:00Z");
const pins = new Set(["pinned"]);

test("closing soon includes only open polls closing within 24 hours", () => {
  const matches = (closesAt) => matchesPulse({ id: "p", closesAt }, "closing", {}, pins, now);
  assert.equal(matches(now), false);
  assert.equal(matches(now + 1), true);
  assert.equal(matches(now + 24 * 60 * 60 * 1000), true);
  assert.equal(matches(now + 24 * 60 * 60 * 1000 + 1), false);
  assert.equal(matches(null), false);
});

test("votes include option zero in shared and local modes", () => {
  assert.equal(hasVoted({ id: "p", votedPosition: 0 }, {}), true);
  assert.equal(hasVoted({ id: "p" }, { p: 0 }), true);
  assert.equal(hasVoted({ id: "p", votedPosition: null }, {}), false);
  assert.equal(matchesPulse({ id: "p" }, "voted", {}, pins, now), false);
});

test("pinned and all views select the appropriate polls", () => {
  assert.equal(matchesPulse({ id: "pinned" }, "pinned", {}, pins, now), true);
  assert.equal(matchesPulse({ id: "other" }, "pinned", {}, pins, now), false);
  assert.equal(matchesPulse({ id: "other" }, "all", {}, pins, now), true);
});

test("Window counts match the feed filters for shared poll rows", () => {
  const rows = [
    { id: "pinned", my_option_position: 0, closes_at: new Date(now + 1000).toISOString() },
    { id: "other", my_option_position: null, closes_at: new Date(now - 1000).toISOString() },
    { id: "untimed" }
  ];
  assert.deepEqual(pulseCounts(rows, pins, now), { all: 3, closing: 1, voted: 1, pinned: 1 });
});
