import test from "node:test";
import assert from "node:assert/strict";
import { calculateAtaScore, normalizeMapRank, rankToHeatBucket } from "./localMap.js";

test("calculateAtaScore falls back to 20 for missing ranks", () => {
  const score = calculateAtaScore([{ rank: 1 }, { rank: null }, { rank: 10 }, { rank: null }]);
  assert.equal(score, 12.75);
});

test("normalizeMapRank rejects invalid values", () => {
  assert.equal(normalizeMapRank(null), null);
  assert.equal(normalizeMapRank("abc"), null);
  assert.equal(normalizeMapRank(0), null);
  assert.equal(normalizeMapRank(7.2), 7);
});

test("rankToHeatBucket maps rank ranges", () => {
  assert.equal(rankToHeatBucket(1), "green");
  assert.equal(rankToHeatBucket(6), "yellow");
  assert.equal(rankToHeatBucket(15), "orange");
  assert.equal(rankToHeatBucket(30), "red");
  assert.equal(rankToHeatBucket(null), "red");
});
