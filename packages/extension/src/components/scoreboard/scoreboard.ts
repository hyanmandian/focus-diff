import { h } from "@/utils/dom/dom";

const FLIP_MS = 260;
const SEPARATOR = /[,.:/\s]/u;

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

export const createScoreboard = (className: string) => {
  const element = h("span", { className: `scoreboard ${className}`, "aria-hidden": "true" });
  let shape = "";
  let shown: string[] = [];

  const set = (text: string, widest: string) => {
    let cells = Array.from(widest);
    let characters = layout(text, cells);
    if (!characters) {
      cells = Array.from(text);
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
      const cell = element.children[index]!;
      cell.textContent = character;
      if (character) flip(cell);
    });
    shown = characters;
  };

  return { element, set };
};
