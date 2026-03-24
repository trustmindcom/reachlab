import { activityIdToDate } from "../shared/utils.js";
import type { ScrapedCompanyPost, ScrapedPostContent } from "../shared/types.js";

/**
 * Scrape the company page analytics content engagement table.
 * URL: /company/{id}/admin/analytics/updates
 *
 * Verified DOM structure (Chrome DevTools, 2026-03-24):
 *
 *   <table class="org-analytics__table table">
 *     <tbody class="org-update-engagement-table__table-body--high-height">
 *       <tr>                              ← one per post
 *         <td>[0] Post title — contains <a href="/company/{id}/admin/post-analytics/urn:li:activity:{id}/">
 *         <td>[1] Post type — "Video", "Image", "Text", etc.
 *         <td>[2] Audience — "All followers"
 *         <td>[3] Impressions
 *         <td>[4] Views
 *         <td>[5] Clicks
 *         <td>[6] CTR — e.g. "0%"
 *         <td>[7] Reactions
 *         <td>[8] Comments
 *         <td>[9] Reposts
 *         <td>[10] Follows — can be "-"
 *         <td>[11] Engagement rate — e.g. "25%"
 *       </tr>
 *
 * Pagination: <div class="artdeco-pagination"> — hidden via
 *   .artdeco-pagination--hide-pagination when all rows fit on one page.
 *   When visible, has prev/next buttons.
 */
export function scrapeCompanyAnalytics(doc: Document): ScrapedCompanyPost[] {
  const posts: ScrapedCompanyPost[] = [];

  const tbody = doc.querySelector(".org-update-engagement-table__table-body--high-height");
  if (!tbody) return posts;

  const rows = tbody.querySelectorAll("tr");

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 12) continue;

    // Cell 0: post title with link containing activity ID
    const link = cells[0].querySelector('a[href*="/admin/post-analytics/urn:li:activity:"]');
    if (!link) continue;
    const href = link.getAttribute("href") ?? "";
    const activityMatch = href.match(/activity[:-](\d+)/);
    if (!activityMatch) continue;

    const activityId = activityMatch[1];
    const contentPreview = link.textContent?.trim()?.slice(0, 300) ?? null;
    const publishedAt = activityIdToDate(activityId).toISOString();

    // Cell 1: post type
    const typeText = cells[1].textContent?.trim()?.toLowerCase() ?? "";
    let contentType: "text" | "image" | "carousel" | "video" | "article" = "text";
    if (typeText.includes("video")) contentType = "video";
    else if (typeText.includes("image")) contentType = "image";
    else if (typeText.includes("carousel") || typeText.includes("document")) contentType = "carousel";
    else if (typeText.includes("article")) contentType = "article";

    // Cells 3-11: metrics (parse "-" as null)
    const parseCell = (cell: Element): number | null => {
      const text = cell.textContent?.trim() ?? "-";
      if (text === "-") return null;
      const cleaned = text.replace(/[,%]/g, "");
      const num = Number(cleaned);
      return isNaN(num) ? null : num;
    };

    const parsePct = (cell: Element): number | null => {
      const text = cell.textContent?.trim() ?? "-";
      if (text === "-") return null;
      const num = parseFloat(text);
      return isNaN(num) ? null : num / 100;
    };

    posts.push({
      id: activityId,
      content_preview: contentPreview,
      content_type: contentType,
      published_at: publishedAt,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`,
      impressions: parseCell(cells[3]),   // Impressions
      views: parseCell(cells[4]),          // Views
      clicks: parseCell(cells[5]),         // Clicks
      click_through_rate: parsePct(cells[6]),  // CTR
      reactions: parseCell(cells[7]),      // Reactions
      comments: parseCell(cells[8]),       // Comments
      reposts: parseCell(cells[9]),        // Reposts
      follows: parseCell(cells[10]),       // Follows
      engagement_rate: parsePct(cells[11]),// Engagement rate
    });
  }

  return posts;
}

/**
 * Check if the analytics table has more pages to load.
 * Returns true if pagination exists and is not hidden.
 */
export function hasMoreAnalyticsPages(doc: Document): boolean {
  const pagination = doc.querySelector(".artdeco-pagination");
  if (!pagination) return false;
  return !pagination.classList.contains("artdeco-pagination--hide-pagination");
}

/**
 * Scrape company page posts for full text content.
 * URL: /company/{id}/admin/page-posts/published
 *
 * Verified DOM structure (Chrome DevTools, 2026-03-24):
 *
 *   <div class="feed-shared-update-v2" data-urn="urn:li:activity:{id}">
 *     <div class="feed-shared-update-v2__description">
 *       <div class="update-components-text">
 *         <span class="break-words">            ← full post text
 *       <button class="...see-more-less-toggle"> ← "…more" if truncated
 *     <video> or <img>                           ← media
 */
export function scrapeCompanyPosts(doc: Document): (ScrapedPostContent & { id: string })[] {
  const posts: (ScrapedPostContent & { id: string })[] = [];

  const postEls = doc.querySelectorAll(".feed-shared-update-v2");

  for (const post of postEls) {
    const dataUrn = post.getAttribute("data-urn");
    if (!dataUrn?.includes("activity")) continue;
    const activityId = dataUrn.match(/activity:(\d+)/)?.[1];
    if (!activityId) continue;

    // Text: .feed-shared-update-v2__description .update-components-text .break-words
    const textEl = post.querySelector(
      ".feed-shared-update-v2__description .update-components-text .break-words"
    );
    const fullText = textEl?.textContent?.trim() ?? null;
    if (!fullText) continue;

    // Images: non-profile, non-logo images
    const images = Array.from(post.querySelectorAll("img") as NodeListOf<HTMLImageElement>)
      .map((img: HTMLImageElement) => img.getAttribute("src") ?? "")
      .filter(src => src.includes("media.licdn.com") && !src.includes("profile") && !src.includes("logo"));

    // Video
    const videoEl = post.querySelector("video");
    const videoSrc = videoEl?.getAttribute("src") ??
      videoEl?.querySelector("source")?.getAttribute("src") ?? null;

    posts.push({
      id: activityId,
      hook_text: fullText.slice(0, 300),
      full_text: fullText,
      image_urls: images,
      video_url: videoSrc,
    });
  }

  return posts;
}
