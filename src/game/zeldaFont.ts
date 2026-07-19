// the zelda pixel font (declared in styles/index.css). nothing in the DOM
// uses it, so nothing triggers its download — canvas draws must request it
// explicitly or they silently fall back to monospace.
export const ZELDA_FONT_STACK = '"Zelda DX TT BRK", ui-monospace, Menlo, Consolas, monospace';
// the pixel font sets glyphs wide; tighten it a touch for canvas text.
export const ZELDA_LETTER_SPACING = "-1px";

let requested = false;

export function ensureZeldaFontLoaded(): void {
	if (requested) return;
	requested = true;
	document.fonts.load(`16px ${ZELDA_FONT_STACK}`).catch(() => {});
}
