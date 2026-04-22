/**
 * Fetch high-res images by navigating to each post in Chrome DevTools,
 * extracting the image URL from the DOM, and downloading it.
 *
 * Usage: npx tsx scripts/fetch-hires-via-devtools.ts
 *
 * Requires: Chrome DevTools MCP running, logged into LinkedIn
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../data/linkedin.db");
const IMAGES_DIR = path.join(__dirname, "../data/images");

const db = new Database(DB_PATH);

// Get all image/carousel posts that need upgrading
const posts = db.prepare(`
  SELECT id FROM posts
  WHERE persona_id = 1
    AND content_type IN ('image', 'carousel')
    AND image_urls NOT LIKE '%articleshare%'
  ORDER BY published_at DESC
`).all() as { id: string }[];

// Filter to ones that need work (missing, broken, or 160px)
const needsWork: string[] = [];
for (const post of posts) {
  const imgPath = path.join(IMAGES_DIR, post.id, "0.jpg");
  if (!fs.existsSync(imgPath)) {
    needsWork.push(post.id);
    continue;
  }
  // Check file size — 160px JPEGs are typically under 10KB
  const stats = fs.statSync(imgPath);
  if (stats.size < 10000) {
    needsWork.push(post.id);
    continue;
  }
  // Check if it's actually an image
  const buf = Buffer.alloc(4);
  const fd = fs.openSync(imgPath, 'r');
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  // JPEG magic bytes: FF D8 FF
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) {
    needsWork.push(post.id);
  }
}

console.log(`${needsWork.length} posts need high-res images (of ${posts.length} total)`);
console.log(`Post IDs: ${needsWork.join(', ')}`);
console.log(`\nTo process: navigate to each post URL in Chrome DevTools,`);
console.log(`extract the feedshare-shrink URL, and download it.`);
console.log(`\nURLs to visit:`);
for (const id of needsWork) {
  console.log(`  https://www.linkedin.com/feed/update/urn:li:activity:${id}/`);
}

db.close();
