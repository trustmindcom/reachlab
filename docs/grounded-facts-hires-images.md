<!-- WORKING ARTIFACT — do NOT commit -->

# Grounded Facts: High-Res Image Downloads

## Observations

[OBS-1] The backfill navigates to `/feed/update/` URLs only
      @extension/src/background/service-worker.ts:L672-L672
      "const postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${postId}/`;"

[OBS-2] LinkedIn sometimes redirects `/feed/update/` to `/posts/` URLs (validated via Chrome DevTools — navigating to 7429604906359095296 landed on `/posts/natetrustmind_...`)

[OBS-3] The content script manifest matches only analytics, feed, and company URLs — NOT /posts/
      @extension/manifest.json:L14-L18
      "\"matches\": [\"*://*.linkedin.com/analytics/*\", \"*://*.linkedin.com/feed/*\", \"*://*.linkedin.com/posts/*\", \"*://*.linkedin.com/company/*/admin/*\"]"

CORRECTION: After our edit, /posts/* IS in manifest.json. So this is no longer a problem.

[OBS-4] scrapePostContent sends a scrape command; if the response type isn't "post-content", imageUrls stays empty array
      @extension/src/background/service-worker.ts:L688-L704
      "let imageUrls: string[] = []; ... if (hookResult.type === 'post-content') { ... imageUrls = hookResult.data.image_urls; } else { console.warn(...) }"

[OBS-5] scrapeAndSendPostContent sends the scraped content with image_urls to the server
      @extension/src/background/service-worker.ts:L758-L766
      "const content = await scrapePostContent(tabId, postId); await postToServer({ posts: [content] });"

[OBS-6] upsertPost uses COALESCE — if incoming image_urls is empty/null, the old DB value is kept
      @server/src/db/queries.ts:L18-L31
      "const imageUrlsJson = post.image_urls && post.image_urls.length > 0 ? JSON.stringify(post.image_urls) : null; ... image_urls = COALESCE(@image_urls, image_urls),"

[OBS-7] The image download trigger uses post.image_urls from the payload, NOT from the DB
      @server/src/routes/ingest.ts:L210-L221
      "const postsWithImages = payload.posts.filter((p) => p.image_urls && p.image_urls.length > 0); ... downloadPostImages(post.id, post.image_urls!, dataDir)"

[OBS-8] The download trigger skips if getImageLocalPaths returns non-null
      @server/src/routes/ingest.ts:L219-L219
      "if (getImageLocalPaths(db, post.id)) continue;"

[OBS-9] The startup retry loop reads image_urls from the DB (old expired URLs)
      @server/src/app.ts:L277-L279
      "const urls = JSON.parse(post.image_urls) as string[]; downloadPostImages(post.id, urls, imagesDir)"

[OBS-10] The content script scraper rewrites URLs — NO, we fixed this. Current code passes src through unchanged.
      @extension/src/content/scrapers.ts:L246-L248
      "if (src && src.includes(\"media.licdn.com\") && src.includes(\"feedshare-shrink\")) { imageUrls.push(src); }"

[OBS-11] LinkedIn auth tokens are tied to the exact URL path — rewriting feedshare-shrink_1280 to _800 invalidates the token (validated via curl: _1280 downloads OK, _800 returns HTML error page)

[OBS-12] The continueBackfill outer catch clears the entire queue on any error
      @extension/src/background/service-worker.ts:L1120-L1122
      "} catch (err: any) { console.error(\"[ReachLab] Backfill error:\", err.message); await chrome.storage.session.set({ backfillQueue: null, backfillCursor: null }); }"

[OBS-13] postToServer throws on failure (re-throws after queueing)
      @extension/src/background/service-worker.ts:L1275-L1282
      "try { return await postToServerDirect(payload); } catch (err) { await queueForRetry(payload); throw err; }"

[OBS-14] scrapeAndSendPostContent doesn't catch — if postToServer throws, the error propagates
      @extension/src/background/service-worker.ts:L758-L766
      "async function scrapeAndSendPostContent(tabId: number, postId: string): Promise<void> { const content = await scrapePostContent(tabId, postId); await postToServer({ posts: [content] }); }"

[OBS-15] The inner try/catch in continueBackfill catches per-post errors
      @extension/src/background/service-worker.ts:L1106-L1110
      "try { await scrapeAndSendPostContent(tab.id, postId); } catch (err: any) { console.error(`[ReachLab] Backfill failed for ${postId}:`, err.message); }"

## Derived Claims

[DER from OBS-4 + OBS-6] When scraping fails (hookResult.type !== "post-content"), imageUrls is [] → imageUrlsJson becomes null → COALESCE keeps old expired URL in DB. The server download trigger (OBS-7) uses payload image_urls which is [], so postsWithImages filter excludes it. No download attempt from the payload. But the STARTUP retry (OBS-9) reads the old expired URL from DB and tries to download → 403.

[DER from OBS-7 + OBS-8] When the extension sends a post with fresh image_urls, the download trigger uses those payload URLs directly. But first upsertPost (line 59) runs and overwrites the DB. Then line 219 checks getImageLocalPaths. If local paths are null (cleared), the download proceeds using payload URLs. This path is correct.

[DER from OBS-12 + OBS-15] The inner try/catch (OBS-15) catches per-post scrape/send failures. The outer catch (OBS-12) would only fire if something outside the per-post loop throws — like tab creation failing or chrome.storage.session.set failing. So individual post failures should NOT kill the queue.

[DER from OBS-1 + OBS-2] Some posts redirect to /posts/ URLs. Content script now matches /posts/* (OBS-3 correction), so this should work.

## Key Question

The backfill isn't producing ingests. Only 2 ingests in the current server session despite 59 posts in needs-images. The inner per-post catch (OBS-15) should prevent individual failures from killing the queue (DER from OBS-12+15). So either:

A) The backfill queue is never being set (finishSync isn't reaching the needs-images fetch)
B) The alarm "backfill-continue" isn't firing
C) Tab creation is failing (line 1097) — this throws outside the inner catch
D) The extension service worker isn't running the updated code

We CANNOT inspect the extension service worker console. We CAN test the actual behavior end-to-end via Chrome DevTools.
