import {
  parseMetricValue,
  parseWatchTime,
  detectContentType,
  extractActivityId,
  activityIdToDate,
} from "../shared/utils.js";
import type {
  ScrapedPost,
  ScrapedPostMetrics,
  ScrapedPostContent,
  ScrapedAudience,
  ScrapedProfileViews,
  ScrapedSearchAppearances,
} from "../shared/types.js";

/**
 * Extract summary KPI values from a page using the shared
 * .member-analytics-addon-summary pattern.
 */
function extractSummaryKPIs(doc: Document): Record<string, number | null> {
  const kpis: Record<string, number | null> = {};
  const items = doc.querySelectorAll(
    ".member-analytics-addon-summary__list-item"
  );
  for (const item of items) {
    const label = item
      .querySelector(".member-analytics-addon-list-item__description")
      ?.textContent?.trim()
      ?.toLowerCase();
    const valueText = item
      .querySelector(".text-heading-large")
      ?.textContent?.trim();
    if (label && valueText) {
      kpis[label] = parseMetricValue(valueText);
    }
  }
  return kpis;
}

/**
 * Scrape the top-posts list page.
 * Returns an array of posts with IDs, content previews, impressions, and content types.
 */
export function scrapeTopPosts(doc: Document): ScrapedPost[] {
  const posts: ScrapedPost[] = [];
  const postItems = doc.querySelectorAll(
    ".member-analytics-addon__mini-update-item"
  );

  for (const item of postItems) {
    const href = item.getAttribute("href") ?? "";
    const activityId = extractActivityId(href);
    if (!activityId) continue;

    // Content preview: try aria-label first, fall back to inline text body
    const ariaEl = item.querySelector("[aria-label]");
    const ariaLabel = ariaEl?.getAttribute("aria-label") ?? null;
    const ariaPreview =
      ariaLabel &&
      ariaLabel !== "Image" &&
      !ariaLabel.includes("posted this")
        ? ariaLabel
        : null;
    // Fallback: the inline text body (works for video/image posts where aria-label is generic)
    const inlineText = item
      .querySelector(".inline-show-more-text span")
      ?.textContent?.trim() ?? null;
    const contentPreview = ariaPreview || inlineText;

    // Content type detection
    const contentType = detectContentType(item);

    // Published date from activity ID
    const publishedAt = activityIdToDate(activityId).toISOString();

    // Find the companion CTA element for impressions
    // The CTA is a sibling to the post item, within the same <li>
    const parentLi = item.closest("li");
    const ctaEl = parentLi?.querySelector(
      ".member-analytics-addon__cta-item-with-secondary-anchor"
    );
    const impressionText = ctaEl
      ?.querySelector(
        ".member-analytics-addon__cta-item-with-secondary-list-item-title"
      )
      ?.textContent?.trim();
    const impressions = impressionText
      ? parseMetricValue(impressionText)
      : null;

    // Thumbnail image URL from the analytics page preview
    let thumbnailUrl: string | null = null;
    const thumbImg = item.querySelector(
      ".ivm-image-view-model img[src*='media.licdn.com']"
    ) as HTMLImageElement | null;
    if (thumbImg?.src) {
      thumbnailUrl = thumbImg.src;
    }

    posts.push({
      id: activityId,
      content_preview: contentPreview,
      content_type: contentType,
      published_at: publishedAt,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`,
      impressions,
      thumbnail_url: thumbnailUrl,
    });
  }

  return posts;
}

/**
 * Scrape a post detail page for all metrics.
 */
export function scrapePostDetail(doc: Document): ScrapedPostMetrics {
  const result: ScrapedPostMetrics = {
    impressions: null,
    members_reached: null,
    reactions: null,
    comments: null,
    reposts: null,
    saves: null,
    sends: null,
    video_views: null,
    watch_time_seconds: null,
    avg_watch_time_seconds: null,
    new_followers: null,
  };

  const cards = doc.querySelectorAll(
    ".member-analytics-addon-card__base-card"
  );

  for (const card of cards) {
    const title = card
      .querySelector(".member-analytics-addon-header__title")
      ?.textContent?.trim();

    if (title === "Discovery" || title === "Social engagement") {
      // CTA list item pattern
      const items = card.querySelectorAll(
        ".member-analytics-addon__cta-list-item"
      );
      for (const item of items) {
        const label = item
          .querySelector(".text-body-small")
          ?.textContent?.trim()
          ?.toLowerCase();
        const valueText = item.querySelector("strong")?.textContent?.trim();
        if (!label || !valueText) continue;

        const value = parseMetricValue(valueText);
        if (label === "impressions") result.impressions = value;
        else if (label === "members reached") result.members_reached = value;
        else if (label === "reactions") result.reactions = value;
        else if (label === "comments") result.comments = value;
        else if (label === "reposts") result.reposts = value;
        else if (label === "saves") result.saves = value;
        else if (label.includes("sends")) result.sends = value;
      }
    } else if (title === "Profile activity") {
      // Metric row pattern (no CTA items, uses metric-row-list-item)
      const items = card.querySelectorAll(
        ".member-analytics-addon-metric-row-list-item"
      );
      for (const item of items) {
        const label = item
          .querySelector(".member-analytics-addon-metric-row-list-item__title--color")
          ?.textContent?.trim()
          ?.toLowerCase();
        const valueText = item
          .querySelector(".member-analytics-addon-metric-row-list-item__value")
          ?.textContent?.trim();
        if (!label || !valueText) continue;

        const value = parseMetricValue(valueText);
        if (label.includes("followers gained")) result.new_followers = value;
      }
    } else if (title === "Video performance") {
      // Summary KPI pattern for video metrics
      const items = card.querySelectorAll(
        ".member-analytics-addon-summary__list-item"
      );
      for (const item of items) {
        const label = item
          .querySelector(".member-analytics-addon-list-item__description")
          ?.textContent?.trim()
          ?.toLowerCase();
        const valueText = item
          .querySelector(".text-heading-large")
          ?.textContent?.trim();
        if (!label || !valueText) continue;

        if (label === "video views") {
          result.video_views = parseMetricValue(valueText);
        } else if (label === "watch time") {
          result.watch_time_seconds = parseWatchTime(valueText);
        } else if (label === "average watch time") {
          result.avg_watch_time_seconds = parseWatchTime(valueText);
        }
      }
    }
  }

  return result;
}

/**
 * Scrape a post page for hook text, full text, and image URLs.
 */
export function scrapePostPage(doc: Document): ScrapedPostContent {
  // Extract hook text — the visible text before "see more"
  let hookText: string | null = null;
  let fullText: string | null = null;

  const textContainer = doc.querySelector(".feed-shared-inline-show-more-text");
  if (textContainer) {
    const textSpan = textContainer.querySelector(".break-words");
    if (textSpan) {
      hookText = textSpan.textContent?.trim() || null;
      // Preserve paragraph breaks: replace <br> tags with newlines, then get text
      const clone = textSpan.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      // Also treat block-level elements as paragraph breaks
      clone.querySelectorAll("p, div").forEach((el) => {
        el.insertAdjacentText("beforebegin", "\n");
      });
      fullText = clone.textContent?.trim().replace(/\n{3,}/g, "\n\n") || null;
    }
  }

  // Extract image URLs — look for LinkedIn CDN images in the post
  const imageUrls: string[] = [];
  const images = doc.querySelectorAll(
    '.feed-shared-image img[src*="media.licdn.com"], ' +
    '.feed-shared-carousel img[src*="media.licdn.com"], ' +
    '.feed-shared-document img[src*="media.licdn.com"]'
  );
  for (const img of images) {
    const src = img.getAttribute("src");
    if (src && src.includes("media.licdn.com")) {
      imageUrls.push(src);
    }
  }

  // Video URL capture is handled by the service worker's webRequest listener
  // (content scripts can't access performance entries from the page's isolated world,
  // and LinkedIn videos use blob: URLs in the DOM, not direct src attributes).
  const videoUrl: string | null = null;

  // Comment stats: count author replies and check for threaded replies
  let authorReplies: number | null = null;
  let hasThreads: boolean | null = null;

  const commentSection = doc.querySelector(".comments-comments-list");
  if (commentSection) {
    // Find the post author's name from the page header
    const authorNameEl = doc.querySelector(
      ".update-components-actor__title .visually-hidden, " +
      ".update-components-actor__title span[aria-hidden='true']"
    );
    const authorName = authorNameEl?.textContent?.trim()?.toLowerCase() ?? "";

    if (authorName) {
      const allComments = commentSection.querySelectorAll(
        ".comments-comment-entity"
      );
      let authorReplyCount = 0;
      let foundThreads = false;

      for (const comment of allComments) {
        // Check if this comment is by the author
        const commenterNameEl = comment.querySelector(
          ".comments-comment-meta__description-title"
        );
        const commenterName = commenterNameEl?.textContent?.trim()?.toLowerCase() ?? "";
        if (commenterName && authorName && commenterName.includes(authorName)) {
          authorReplyCount++;
        }
        // Check for threaded replies (reply entities or reply lists)
        if (comment.classList.contains("comments-comment-entity--reply") ||
            comment.querySelector(".comments-replies-list")) {
          foundThreads = true;
        }
      }

      authorReplies = authorReplyCount;
      hasThreads = foundThreads;
    }
  }

  return { hook_text: hookText, full_text: fullText, image_urls: imageUrls, video_url: videoUrl, author_replies: authorReplies, has_threads: hasThreads };
}

/**
 * Scrape the current user's profile photo URL from the page nav/header.
 */
export function scrapeProfilePhoto(doc: Document): string | null {
  // LinkedIn nav bar profile photo (mini-profile image in the global nav)
  const selectors = [
    ".global-nav__me-photo",
    "img.feed-identity-module__member-photo",
    "img.member-analytics-addon__member-photo",
    ".global-nav__primary-link-me-menu-trigger img",
    "img.nav-item__profile-member-photo",
  ];
  for (const sel of selectors) {
    const img = doc.querySelector(sel) as HTMLImageElement | null;
    if (img?.src && img.src.includes("media.licdn.com")) {
      return img.src;
    }
  }
  // Fallback: any small profile photo in the page header area
  const allImgs = doc.querySelectorAll("img[src*='media.licdn.com']");
  for (const img of allImgs) {
    const src = (img as HTMLImageElement).src;
    const alt = (img as HTMLImageElement).alt?.toLowerCase() || "";
    // Profile photos typically have the user's name as alt text and are small
    if (alt && !alt.includes("logo") && !alt.includes("company") &&
        (img.closest(".global-nav") || img.closest(".feed-identity-module") ||
         img.closest(".member-analytics-addon"))) {
      return src;
    }
  }
  return null;
}

/**
 * Scrape the audience page for total followers.
 */
export function scrapeAudience(doc: Document): ScrapedAudience {
  const kpis = extractSummaryKPIs(doc);
  return {
    total_followers: kpis["total followers"] ?? null,
  };
}

/**
 * Scrape the profile views page.
 */
export function scrapeProfileViews(doc: Document): ScrapedProfileViews {
  const kpis = extractSummaryKPIs(doc);
  return {
    profile_views: kpis["profile viewers"] ?? null,
  };
}

/**
 * Scrape the search appearances page.
 */
export function scrapeSearchAppearances(
  doc: Document
): ScrapedSearchAppearances {
  const kpis = extractSummaryKPIs(doc);
  return {
    all_appearances: kpis["all appearances"] ?? null,
    search_appearances: kpis["search appearances"] ?? null,
  };
}
