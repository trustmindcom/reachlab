import { describe, it, expect, beforeEach } from "vitest";
import { waitFor } from "../shared/utils.js";

describe("waitFor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves immediately when predicate is already truthy", async () => {
    const result = await waitFor(() => true, 100);
    expect(result).toBe(true);
  });

  it("returns the truthy value from the predicate (not just true)", async () => {
    document.body.innerHTML = '<div id="found">hi</div>';
    const el = await waitFor(
      () => document.getElementById("found"),
      100
    );
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("hi");
  });

  it("resolves after a mutation makes the predicate true", async () => {
    const promise = waitFor(
      () => document.querySelector(".target"),
      500
    );
    setTimeout(() => {
      const div = document.createElement("div");
      div.className = "target";
      document.body.appendChild(div);
    }, 20);
    const el = await promise;
    expect(el).not.toBeNull();
  });

  it("resolves when predicate transitions from false to true via nested mutation", async () => {
    const promise = waitFor(() => {
      const cards = document.querySelectorAll(".card");
      for (const c of cards) {
        if (c.textContent?.includes("engagement")) return true;
      }
      return false;
    }, 500);

    // First add a card that does NOT match
    const first = document.createElement("div");
    first.className = "card";
    first.textContent = "other";
    document.body.appendChild(first);

    // Then add the matching one after a delay
    setTimeout(() => {
      const second = document.createElement("div");
      second.className = "card";
      second.textContent = "engagement stats";
      document.body.appendChild(second);
    }, 20);

    const result = await promise;
    expect(result).toBe(true);
  });

  it("returns null on timeout", async () => {
    const result = await waitFor(() => false, 30);
    expect(result).toBeNull();
  });

  it("treats 0 as falsy and keeps waiting", async () => {
    // Regression: predicates that return 0 (e.g. .length === 0) must not
    // accidentally resolve because 0 is falsy.
    const promise = waitFor(() => document.querySelectorAll(".x").length, 80);
    setTimeout(() => {
      document.body.appendChild(document.createElement("div")).className = "x";
    }, 20);
    const result = await promise;
    expect(result).toBe(1);
  });
});
