import { describe, expect, it } from "vitest";
import { getBatchSlice, getServerUrlCandidates } from "../background/sync-helpers.js";

describe("getBatchSlice", () => {
  it("returns the next fixed-size batch and cursor", () => {
    expect(getBatchSlice(["a", "b", "c", "d"], 0, 2)).toEqual({
      batch: ["a", "b"],
      nextCursor: 2,
    });
  });

  it("caps the final batch at the queue length", () => {
    expect(getBatchSlice(["a", "b", "c", "d"], 3, 2)).toEqual({
      batch: ["d"],
      nextCursor: 4,
    });
  });

  it("returns an empty batch when the cursor is already complete", () => {
    expect(getBatchSlice(["a", "b"], 2, 10)).toEqual({
      batch: [],
      nextCursor: 2,
    });
  });
});

describe("getServerUrlCandidates", () => {
  it("prefers the last known-good server URL without duplicating it", () => {
    expect(
      getServerUrlCandidates("http://localhost:3210", [
        "http://localhost:3211",
        "http://localhost:3210",
      ])
    ).toEqual(["http://localhost:3210", "http://localhost:3211"]);
  });

  it("returns defaults in order when there is no preferred URL", () => {
    expect(
      getServerUrlCandidates(null, [
        "http://localhost:3211",
        "http://localhost:3210",
      ])
    ).toEqual(["http://localhost:3211", "http://localhost:3210"]);
  });
});
