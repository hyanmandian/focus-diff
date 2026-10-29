const PANEL = "focus-diff-panel";
const FILE_CLASS = "focus-diff-file";
const ACTIVE = "data-focus-diff-filtering";
const STYLE_ID = "focus-diff-transition";
const MAX_PIECES = 24;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const MOVE_MS = 520;
const ENTER_MS = 460;
const EXIT_MS = 240;
const STAGGER_MS = 45;
const MAX_STAGGER = 8;

let generation = 0;

const CSS = `
html[${ACTIVE}]::view-transition { pointer-events: none; }
html[${ACTIVE}]::view-transition-old(root) { display: none; }
html[${ACTIVE}]::view-transition-new(root) { animation: none; }
html[${ACTIVE}]::view-transition-group(*.${FILE_CLASS}) { animation-duration: ${MOVE_MS}ms; animation-timing-function: ${EASE_OUT}; }
html[${ACTIVE}]::view-transition-old(*.${FILE_CLASS}):only-child,
html[${ACTIVE}]::view-transition-new(*.${FILE_CLASS}):only-child { animation: none; }
html[${ACTIVE}]::view-transition-old(${PANEL}) { display: none; }
html[${ACTIVE}]::view-transition-group(${PANEL}),
html[${ACTIVE}]::view-transition-new(${PANEL}) { animation: none; }
html[${ACTIVE}]::view-transition-new(${PANEL}) { mix-blend-mode: normal; }
html[${ACTIVE}]::view-transition-group(${PANEL}) { z-index: 1; }
html[${ACTIVE}]::view-transition-image-pair(${PANEL}) { isolation: auto; }
`;

export interface Piece {
  key: string;
  element: HTMLElement;
}

export const keepOutOfTransitions = (host: HTMLElement): void => {
  host.style.setProperty("view-transition-name", PANEL);
};

const onScreen = (pieces: Piece[]) =>
  pieces
    .map((piece) => ({ ...piece, box: piece.element.getBoundingClientRect() }))
    .filter(({ box }) => box.height > 0 && box.bottom > 0 && box.top < innerHeight)
    .toSorted((a, b) => a.box.top - b.box.top)
    .slice(0, MAX_PIECES);

export const canTransition = (): boolean =>
  typeof document.startViewTransition === "function" &&
  document.visibilityState === "visible" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

export const withTransition = async (update: () => void, pieces: () => Piece[]): Promise<void> => {
  if (!canTransition()) {
    update();
    return;
  }
  if (!document.querySelector(`#${STYLE_ID}`)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }

  const mine = ++generation;
  const names = new Map<string, string>();
  const nameOf = (key: string) => names.get(key) ?? names.set(key, `focus-diff-${mine}-${names.size}`).get(key)!;
  const named = new Map<HTMLElement, string>();
  const name = (list: { key: string; element: HTMLElement }[]) =>
    list.map(({ key, element }) => {
      element.style.setProperty("view-transition-name", nameOf(key));
      element.style.setProperty("view-transition-class", FILE_CLASS);
      named.set(element, nameOf(key));
      return nameOf(key);
    });
  const unname = () => {
    for (const [element, value] of named) {
      if (element.style.getPropertyValue("view-transition-name") !== value) continue;
      element.style.removeProperty("view-transition-name");
      element.style.removeProperty("view-transition-class");
    }
    named.clear();
  };
  const animations: Animation[] = [];

  const root = document.documentElement;
  root.setAttribute(ACTIVE, "");
  const before = name(onScreen(pieces()));
  let after: string[] = [];
  const transition = document.startViewTransition(() => {
    unname();
    update();
    after = name(onScreen(pieces()));
  });
  try {
    await transition.ready;
    const leaving = before.filter((key) => !after.includes(key));
    const arriving = after.filter((key) => !before.includes(key));
    for (const key of leaving)
      animations.push(
        root.animate(
          { opacity: [1, 0], transform: ["none", "scale(0.96)"], filter: ["none", "blur(3px)"] },
          { duration: EXIT_MS, easing: "ease-in", fill: "both", pseudoElement: `::view-transition-old(${key})` },
        ),
      );
    arriving.forEach((key, index) => {
      animations.push(
        root.animate(
          { opacity: [0, 1], transform: ["translateY(28px) scale(0.98)", "none"] },
          {
            duration: ENTER_MS,
            delay: EXIT_MS / 2 + Math.min(index, MAX_STAGGER) * STAGGER_MS,
            easing: EASE_OUT,
            fill: "both",
            pseudoElement: `::view-transition-new(${key})`,
          },
        ),
      );
    });
    await transition.finished;
  } catch {
  } finally {
    for (const animation of animations) animation.cancel();
    unname();
    if (mine === generation) root.removeAttribute(ACTIVE);
  }
};

export const removeTransitionStyle = (): void => {
  document.querySelector(`#${STYLE_ID}`)?.remove();
  document.documentElement.removeAttribute(ACTIVE);
};
