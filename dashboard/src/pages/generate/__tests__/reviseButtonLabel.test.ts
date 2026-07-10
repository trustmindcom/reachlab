import { describe, expect, it } from "vitest";
import { reviseButtonLabel } from "../reviseButtonLabel";

describe("reviseButtonLabel", () => {
  it("starts over from intent when every draft is rejected", () => {
    expect(reviseButtonLabel(0)).toBe("Start over from my intent");
  });

  it("describes how many included drafts will be revised", () => {
    expect(reviseButtonLabel(1)).toBe("Generate 3 from your 1 included");
    expect(reviseButtonLabel(3)).toBe("Generate 3 from your 3 included");
  });
});
