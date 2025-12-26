import { load } from "cheerio";
import type { Element } from "domhandler";

/**
 * Removes Stitch "chrome" elements (left nav, side rails, divider borders)
 * from a Stitch-exported HTML fragment so we can embed only the page content.
 */
export function stripStitchChrome(html: string): string {
  const $ = load(html);

  // Remove known rails (Stitch shell)
  $('nav[class*="w-[72px]"]').remove();
  $('aside[class*="w-[280px]"]').remove();
  $('aside[class*="w-[360px]"]').remove();

  // Remove dark border dividers used by the shell
  $('[class*="border-border-dark"]').each((_: number, el: Element) => {
    const cls = $(el).attr("class") ?? "";
    // If this element is basically just a border line, remove it.
    // (This is conservative: keep it if it has other meaningful layout classes.)
    const onlyBorderish =
      cls.replace(/\s+/g, " ").trim() === "border-border-dark" ||
      cls.includes("border-border-dark") && cls.split(/\s+/).length <= 2;

    if (onlyBorderish) $(el).remove();
  });

  return $.root().html() ?? "";
}

export default stripStitchChrome;
