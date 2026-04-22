/**
 * One-time script: download high-res images for all posts via the API.
 * Run with: node scripts/download-hires-images.mjs
 *
 * Uses Chrome DevTools MCP to navigate to each post in the browser
 * (which has LinkedIn cookies) and extract fresh image URLs,
 * then downloads them server-side.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../data/linkedin.db");
const IMAGES_DIR = path.join(__dirname, "../data/images");

const db = new Database(DB_PATH, { readonly: false });

// Get posts needing images
const posts = db.prepare(`
  SELECT id, image_urls FROM posts
  WHERE persona_id = 1
    AND content_type IN ('image', 'carousel')
    AND image_urls IS NOT NULL AND image_urls != '[]'
    AND (image_local_paths IS NULL OR image_local_paths = '[]')
  ORDER BY published_at DESC
`).all();

console.log(`Found ${posts.length} posts needing image downloads`);

let success = 0;
let failed = 0;

for (const post of posts) {
  const urls = JSON.parse(post.image_urls);
  const postDir = path.join(IMAGES_DIR, post.id);
  fs.mkdirSync(postDir, { recursive: true });

  const localPaths = [];
  let allOk = true;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const filePath = path.join(postDir, `${i}.jpg`);
    const relativePath = `${post.id}/${i}.jpg`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`Too small: ${buf.length} bytes`);
      fs.writeFileSync(filePath, buf);
      localPaths.push(relativePath);
    } catch (err) {
      console.log(`  FAIL ${post.id}/${i}: ${err.message}`);
      allOk = false;
    }
  }

  if (localPaths.length > 0) {
    db.prepare("UPDATE posts SET image_local_paths = ? WHERE id = ?")
      .run(JSON.stringify(localPaths), post.id);
    success++;
    process.stdout.write(".");
  } else {
    failed++;
  }
}

console.log(`\nDone: ${success} downloaded, ${failed} failed`);
db.close();
