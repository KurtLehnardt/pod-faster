/**
 * Strip HTML tags and decode common HTML entities from a string.
 * Useful for rendering feed/episode descriptions that contain raw HTML.
 */
export function stripHtml(html: string): string {
  return (
    html
      // Strip content inside <script> and <style> tags (not just the tags)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      // Strip remaining HTML tags
      .replace(/<[^>]+>/g, " ")
      // Named entities
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&mdash;/gi, "\u2014")
      .replace(/&ndash;/gi, "\u2013")
      .replace(/&hellip;/gi, "\u2026")
      .replace(/&rsquo;/gi, "\u2019")
      .replace(/&lsquo;/gi, "\u2018")
      .replace(/&rdquo;/gi, "\u201C")
      .replace(/&ldquo;/gi, "\u201D")
      // Hex numeric entities (&#xHHH;)
      .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      // Decimal numeric entities (&#NNN;)
      .replace(/&#(\d+);/g, (_match, dec: string) =>
        String.fromCharCode(parseInt(dec, 10))
      )
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}
