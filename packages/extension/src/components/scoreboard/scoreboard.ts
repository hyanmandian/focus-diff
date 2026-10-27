import { h } from "@/utils/dom/dom";

const FLIP_MS = 260;
/** Thousands separators, the slash of a count and the colon of a clock sit between cells instead of filling one. */
const SEPARATOR = /[,.:/\s]/u;

/**
 * Lays `text` out right-aligned on the cells of `widest`, separators on separators. A separator `text` has where the
 * cells have none is left out; with more characters than cells it doesn't fit, and gives `null`.
 */
const isSeparator = (character = "") => SEPARATOR.test(character);

const layout = (text: string, widest: string[]): string[] | null => {
  const characters = Array.from(text);
  const cells = widest.toReversed().map((cell) => {
    if (isSeparator(cell)) return isSeparator(characters.at(-1)) ? characters.pop()!.trim() : "";
    while (isSeparator(characters.at(-1))) characters.pop();
    return characters.pop() ?? "";
  });
  return characters.length > 0 ? null : cells.toReversed();
};

const flip = (cell: Element) => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  cell.animate(
    [
      { transform: "translateY(-45%) rotateX(70deg)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { duration: FLIP_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
};

/**
 * A number on a little scoreboard: every character in a cell of its own, the cells those of the widest text it can
 * show, the unused ones left blank. The cells only change with that widest text, never with the number, so nothing
 * beside it moves; a change flips only the cells whose character changed. It's decoration; the number is read out
 * from text beside it.
 */
export const createScoreboard = (className: string) => {
  const element = h("span", { className: `scoreboard ${className}`, "aria-hidden": "true" });
  let shape = "";
  let shown: string[] = [];

  /** Shows `text` on the cells of `widest`, the widest text this scoreboard has to show. */
  const set = (text: string, widest: string) => {
    let cells = Array.from(widest);
    let characters = layout(text, cells);
    if (!characters) {
      cells = Array.from(text);
      // Laid out on its own characters, a text always fits.
      characters = layout(text, cells)!;
    }
    const nextShape = cells.map((character) => (isSeparator(character) ? "," : "0")).join("");
    if (nextShape !== shape) {
      shape = nextShape;
      shown = cells.map(() => "");
      element.replaceChildren(
        ...Array.from(nextShape, (kind) => h("span", { className: kind === "," ? "cell separator" : "cell" })),
      );
    }
    characters.forEach((character, index) => {
      if (character === shown[index]) return;
      // One cell per character: both come from the same widest text.
      const cell = element.children[index]!;
      cell.textContent = character;
      if (character) flip(cell);
    });
    shown = characters;
  };

  return { element, set };
};
