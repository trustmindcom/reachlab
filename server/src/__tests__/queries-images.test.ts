import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { initDatabase } from "../db/index.js";
import {
  upsertPost,
  getStoredImageUrls,
  setImageLocalPaths,
  getPostsNeedingImages,
} from "../db/queries.js";

const TEST_DB_PATH = path.join(
  import.meta.dirname,
  "../../data/test-queries-images.db"
);

const PERSONA_ID = 1;

let db: Database.Database;

function cleanup() {
  try {
    if (db) db.close();
  } catch {}
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
}

describe("post image query behavior", () => {
  beforeEach(() => {
    cleanup();
    db = initDatabase(TEST_DB_PATH);
  });

  afterAll(() => {
    cleanup();
  });

  it("preserves stored high-res image URLs when top-posts ingest sends shrink_160 thumbnails", () => {
    const postId = "post-high-res";

    upsertPost(db, PERSONA_ID, {
      id: postId,
      content_type: "image",
      published_at: "2025-01-01T12:00:00Z",
      image_urls: [
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_800/test.jpg",
      ],
    });
    setImageLocalPaths(db, postId, JSON.stringify([`${postId}/0.jpg`]));

    upsertPost(db, PERSONA_ID, {
      id: postId,
      content_type: "image",
      published_at: "2025-01-01T12:00:00Z",
      image_urls: [
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_160/test.jpg",
      ],
    });

    expect(getStoredImageUrls(db, postId)).toContain("shrink_800");
    expect(getPostsNeedingImages(db, PERSONA_ID)).not.toContain(postId);
  });

  it("upgrades stored image URLs when a higher-resolution scrape arrives", () => {
    const postId = "post-upgrade";

    upsertPost(db, PERSONA_ID, {
      id: postId,
      content_type: "image",
      published_at: "2025-01-01T12:00:00Z",
      image_urls: [
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_160/test.jpg",
      ],
    });

    upsertPost(db, PERSONA_ID, {
      id: postId,
      content_type: "image",
      published_at: "2025-01-01T12:00:00Z",
      image_urls: [
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_800/test.jpg",
      ],
    });

    expect(getStoredImageUrls(db, postId)).toContain("shrink_800");
  });

  it("preserves multi-image carousel URLs when top-posts ingest only has one thumbnail", () => {
    const postId = "post-carousel";

    upsertPost(db, PERSONA_ID, {
      id: postId,
      content_type: "carousel",
      published_at: "2025-01-01T12:00:00Z",
      image_urls: [
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_800/slide-1.jpg",
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_800/slide-2.jpg",
      ],
    });
    setImageLocalPaths(db, postId, JSON.stringify([`${postId}/0.jpg`, `${postId}/1.jpg`]));

    upsertPost(db, PERSONA_ID, {
      id: postId,
      content_type: "carousel",
      published_at: "2025-01-01T12:00:00Z",
      image_urls: [
        "https://media.licdn.com/dms/image/v2/feedshare-shrink_160/thumb.jpg",
      ],
    });

    const stored = JSON.parse(getStoredImageUrls(db, postId) ?? "[]") as string[];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toContain("shrink_800");
    expect(getPostsNeedingImages(db, PERSONA_ID)).not.toContain(postId);
  });
});
