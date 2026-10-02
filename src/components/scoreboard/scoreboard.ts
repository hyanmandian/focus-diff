import './scoreboard.css';
import { h } from '@/utils/dom';

const FLIP_MS = 260;
/** Thousands separators and the like sit between cells instead of filling one. */
const SEPARATOR = /[,.\s ]/;

/**
 * A number on a little scoreboard: every character in a cell of its own, the cells as many as the number can ever
 * need, the unused ones left blank. A change flips only the cells whose character changed. It's decoration; the number
 * is read out from text beside it.
 */
export const createScoreboard = (className: string) => {
  const element = h('span', { className: `scoreboard ${className}`, 'aria-hidden': 'true' });
  let shown = '';

  const flip = (cell: HTMLElement) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cell.animate(
      [
        { transform: 'translateY(-45%) rotateX(70deg)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: FLIP_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  };

  /** Shows `text` right-aligned in `size` cells. */
  const set = (text: string, size: number) => {
    const padded = text.padStart(size);
    if (padded === shown) return;
    if (padded.length !== shown.length) {
      element.replaceChildren(...[...padded].map(() => h('span', { className: 'cell' })));
      shown = ' '.repeat(padded.length);
    }
    [...padded].forEach((character, index) => {
      if (character === shown[index]) return;
      const cell = element.children[index] as HTMLElement;
      cell.textContent = character.trim();
      cell.classList.toggle('separator', SEPARATOR.test(character) && character.trim() !== '');
      if (character.trim()) flip(cell);
    });
    shown = padded;
  };

  return { element, set };
};
