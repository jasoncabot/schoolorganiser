import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/web/markdown";

const render = (md: string): string => renderMarkdown(md).html;

describe("renderMarkdown", () => {
  it("renders headings under the page's own, paragraphs with their line breaks, and rules", () => {
    expect(render("# Judo club\n\nCome and join us\nevery Wednesday.\n\n---")).toBe(
      "<h3>Judo club</h3>\n<p>Come and join us<br />every Wednesday.</p>\n<hr />",
    );
  });

  it("renders lists, quotes and emphasis", () => {
    expect(render("- **Cost:** £72\n- *Suit* £20\n\n1. Book\n2. Pay\n\n> Quoted")).toBe(
      "<ul><li><strong>Cost:</strong> £72</li><li><em>Suit</em> £20</li></ul>\n" +
        "<ol><li>Book</li><li>Pay</li></ol>\n" +
        "<blockquote><p>Quoted</p></blockquote>",
    );
  });

  it("renders tables", () => {
    expect(render("| Date | Event |\n| --- | --- |\n| Mon 5 Oct | INSET day |")).toBe(
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Event</th></tr></thead>' +
        "<tbody><tr><td>Mon 5 Oct</td><td>INSET day</td></tr></tbody></table></div>",
    );
  });

  it("unescapes toMarkdown's backslashes without starting markup", () => {
    expect(render("7th October 2026\\. Cost \\*£72\\*")).toBe(
      "<p>7th October 2026. Cost *£72*</p>",
    );
  });

  it("escapes HTML and keeps only safe links", () => {
    expect(render('<script>alert(1)</script> & "quotes"')).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>",
    );
    expect(render("[Site](https://example.com/a?b=1&c=2) [Mail](mailto:coach@example.com)")).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer nofollow">Site</a> ' +
        '<a href="mailto:coach@example.com" rel="noopener noreferrer nofollow">Mail</a></p>',
    );
    expect(render("[Click](javascript:void0) [x](data:text/html,hi)")).toBe("<p>Click x</p>");
    expect(render('[a](https://example.com/"onmouseover="x)')).not.toContain('"onmouseover');
  });

  it("leaves emails and underscores alone", () => {
    expect(render("Email coach_sam@example.com about snake_case")).toBe(
      "<p>Email coach_sam@example.com about snake_case</p>",
    );
  });
});
