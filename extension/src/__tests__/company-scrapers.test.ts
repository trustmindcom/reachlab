import { describe, it, expect } from "vitest";
import {
  scrapeCompanyAnalytics,
  hasMoreAnalyticsPages,
  scrapeCompanyPosts,
} from "../content/company-scrapers.js";

function buildDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = html;
  return doc;
}

// A known activity ID → its decoded ISO date
// ID 7437529606678802433 → 2026-03-11T16:07:20.850Z
const ACTIVITY_ID_1 = "7437529606678802433";
const ACTIVITY_DATE_1 = "2026-03-11T16:07:20.850Z";
const ACTIVITY_ID_2 = "7436834189745983488";

/** Shortcut to build a row for the company analytics table. */
function row(activityId: string, type: string, cells: Array<string | number | null>): string {
  // cells is the 9 metric cells (indexes 3..11)
  const cellHtml = cells
    .map((v) => `<td>${v === null ? "-" : v}</td>`)
    .join("");
  return `
    <tr>
      <td><a href="/company/123/admin/post-analytics/urn:li:activity:${activityId}/">Post about ${activityId}</a></td>
      <td>${type}</td>
      <td>All followers</td>
      ${cellHtml}
    </tr>
  `;
}

describe("scrapeCompanyAnalytics", () => {
  it("returns empty array when tbody missing", () => {
    const doc = buildDoc("<div>no table here</div>");
    expect(scrapeCompanyAnalytics(doc)).toEqual([]);
  });

  it("parses a single well-formed row", () => {
    const html = `
      <table><tbody class="org-update-engagement-table__table-body--high-height">
        ${row(ACTIVITY_ID_1, "Video", [
          "1,200", // impressions
          "800",    // views
          "42",     // clicks
          "3.5%",   // CTR
          "15",     // reactions
          "3",      // comments
          "1",      // reposts
          "2",      // follows
          "25%",    // engagement rate
        ])}
      </tbody></table>`;
    const result = scrapeCompanyAnalytics(buildDoc(html));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: ACTIVITY_ID_1,
      content_type: "video",
      published_at: ACTIVITY_DATE_1,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${ACTIVITY_ID_1}/`,
      impressions: 1200,
      views: 800,
      clicks: 42,
      click_through_rate: 0.035,
      reactions: 15,
      comments: 3,
      reposts: 1,
      follows: 2,
      engagement_rate: 0.25,
    });
  });

  it('parses "-" cells as null', () => {
    const html = `
      <table><tbody class="org-update-engagement-table__table-body--high-height">
        ${row(ACTIVITY_ID_1, "Text", [null, null, null, null, null, null, null, null, null])}
      </tbody></table>`;
    const r = scrapeCompanyAnalytics(buildDoc(html))[0];
    expect(r.impressions).toBeNull();
    expect(r.click_through_rate).toBeNull();
    expect(r.follows).toBeNull();
    expect(r.engagement_rate).toBeNull();
  });

  it("detects content_type from cell 1 text", () => {
    const cells = ["0", "0", "0", "0%", "0", "0", "0", "-", "0%"];
    const types = [
      { input: "Video", expected: "video" },
      { input: "Image", expected: "image" },
      { input: "Carousel", expected: "carousel" },
      { input: "Document", expected: "carousel" },
      { input: "Article", expected: "article" },
      { input: "Text", expected: "text" },
      { input: "Something else", expected: "text" },
    ] as const;

    for (const { input, expected } of types) {
      const html = `
        <table><tbody class="org-update-engagement-table__table-body--high-height">
          ${row(ACTIVITY_ID_1, input, [...cells])}
        </tbody></table>`;
      const r = scrapeCompanyAnalytics(buildDoc(html))[0];
      expect(r.content_type, `input=${input}`).toBe(expected);
    }
  });

  it("truncates content_preview to 300 characters", () => {
    const longTitle = "x".repeat(500);
    const html = `
      <table><tbody class="org-update-engagement-table__table-body--high-height">
        <tr>
          <td><a href="/company/1/admin/post-analytics/urn:li:activity:${ACTIVITY_ID_1}/">${longTitle}</a></td>
          <td>Text</td><td>All followers</td>
          <td>0</td><td>0</td><td>0</td><td>0%</td><td>0</td><td>0</td><td>0</td><td>-</td><td>0%</td>
        </tr>
      </tbody></table>`;
    const r = scrapeCompanyAnalytics(buildDoc(html))[0];
    expect(r.content_preview?.length).toBe(300);
  });

  it("skips rows without an activity-id link", () => {
    const html = `
      <table><tbody class="org-update-engagement-table__table-body--high-height">
        <tr>
          <td>No link</td><td>Text</td><td>x</td>
          <td>0</td><td>0</td><td>0</td><td>0%</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0%</td>
        </tr>
        ${row(ACTIVITY_ID_2, "Text", ["1", "1", "1", "1%", "1", "1", "1", "1", "1%"])}
      </tbody></table>`;
    const r = scrapeCompanyAnalytics(buildDoc(html));
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(ACTIVITY_ID_2);
  });

  it("skips rows with fewer than 12 cells", () => {
    const html = `
      <table><tbody class="org-update-engagement-table__table-body--high-height">
        <tr><td>partial</td><td>Text</td><td>x</td></tr>
        ${row(ACTIVITY_ID_1, "Text", ["1", "1", "1", "1%", "1", "1", "1", "1", "1%"])}
      </tbody></table>`;
    const r = scrapeCompanyAnalytics(buildDoc(html));
    expect(r).toHaveLength(1);
  });

  it("parses multiple posts", () => {
    const html = `
      <table><tbody class="org-update-engagement-table__table-body--high-height">
        ${row(ACTIVITY_ID_1, "Video", ["100", "50", "5", "10%", "2", "0", "0", "0", "5%"])}
        ${row(ACTIVITY_ID_2, "Image", ["200", "150", "10", "5%", "20", "5", "2", "1", "15%"])}
      </tbody></table>`;
    const r = scrapeCompanyAnalytics(buildDoc(html));
    expect(r).toHaveLength(2);
    expect(r.map((p) => p.id)).toEqual([ACTIVITY_ID_1, ACTIVITY_ID_2]);
  });
});

describe("hasMoreAnalyticsPages", () => {
  it("returns false when no pagination element exists", () => {
    expect(hasMoreAnalyticsPages(buildDoc("<div></div>"))).toBe(false);
  });

  it("returns true when pagination is visible", () => {
    expect(
      hasMoreAnalyticsPages(buildDoc('<div class="artdeco-pagination"></div>'))
    ).toBe(true);
  });

  it("returns false when pagination is hidden", () => {
    expect(
      hasMoreAnalyticsPages(
        buildDoc(
          '<div class="artdeco-pagination artdeco-pagination--hide-pagination"></div>'
        )
      )
    ).toBe(false);
  });
});

describe("scrapeCompanyPosts", () => {
  it("returns empty when no posts", () => {
    expect(scrapeCompanyPosts(buildDoc("<div></div>"))).toEqual([]);
  });

  it("extracts id and full_text from a post", () => {
    const html = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:${ACTIVITY_ID_1}">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text">
            <span class="break-words">Hello world</span>
          </div>
        </div>
      </div>`;
    const r = scrapeCompanyPosts(buildDoc(html));
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(ACTIVITY_ID_1);
    expect(r[0].full_text).toBe("Hello world");
    expect(r[0].hook_text).toBe("Hello world");
    expect(r[0].image_urls).toEqual([]);
    expect(r[0].video_url).toBeNull();
  });

  it("truncates hook_text to 300 characters but keeps full_text intact", () => {
    const longText = "a".repeat(500);
    const html = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:${ACTIVITY_ID_1}">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text">
            <span class="break-words">${longText}</span>
          </div>
        </div>
      </div>`;
    const r = scrapeCompanyPosts(buildDoc(html))[0];
    expect(r.hook_text?.length).toBe(300);
    expect(r.full_text?.length).toBe(500);
  });

  it("filters images to licdn media (drops profile/logo)", () => {
    const html = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:${ACTIVITY_ID_1}">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text">
            <span class="break-words">Post</span>
          </div>
        </div>
        <img src="https://media.licdn.com/feedshare/img1.jpg" />
        <img src="https://media.licdn.com/profile/avatar.jpg" />
        <img src="https://media.licdn.com/company-logo/logo.jpg" />
        <img src="https://elsewhere.com/img.jpg" />
      </div>`;
    const r = scrapeCompanyPosts(buildDoc(html))[0];
    expect(r.image_urls).toEqual(["https://media.licdn.com/feedshare/img1.jpg"]);
  });

  it("extracts video src from <video> or nested <source>", () => {
    const inline = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:${ACTIVITY_ID_1}">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text"><span class="break-words">x</span></div>
        </div>
        <video src="https://media.licdn.com/v/feedvid.mp4"></video>
      </div>`;
    expect(scrapeCompanyPosts(buildDoc(inline))[0].video_url).toBe(
      "https://media.licdn.com/v/feedvid.mp4"
    );

    const nested = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:${ACTIVITY_ID_2}">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text"><span class="break-words">y</span></div>
        </div>
        <video><source src="https://media.licdn.com/v/nested.mp4" /></video>
      </div>`;
    expect(scrapeCompanyPosts(buildDoc(nested))[0].video_url).toBe(
      "https://media.licdn.com/v/nested.mp4"
    );
  });

  it("skips posts with empty text", () => {
    const html = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:${ACTIVITY_ID_1}">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text"><span class="break-words"></span></div>
        </div>
      </div>`;
    expect(scrapeCompanyPosts(buildDoc(html))).toHaveLength(0);
  });

  it("skips posts missing a data-urn attribute entirely", () => {
    const html = `
      <div class="feed-shared-update-v2">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text"><span class="break-words">x</span></div>
        </div>
      </div>`;
    expect(scrapeCompanyPosts(buildDoc(html))).toHaveLength(0);
  });

  it("skips posts whose data-urn has no activity id", () => {
    const html = `
      <div class="feed-shared-update-v2" data-urn="urn:li:share:999">
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text"><span class="break-words">x</span></div>
        </div>
      </div>`;
    expect(scrapeCompanyPosts(buildDoc(html))).toHaveLength(0);
  });
});
