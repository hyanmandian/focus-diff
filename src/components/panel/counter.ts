import { h } from '@/utils/dom';

const COUNT_MS = 300;

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutExpo = (progress: number) => (progress === 1 ? 1 : 1 - 2 ** (-10 * progress));

export interface Counter {
  element: HTMLSpanElement;
  set: (value: number) => void;
}

/** A number that counts towards new values. The stats block around it reserves width, so the panel never shifts. */
export const counter = (className: string, render: (value: number) => string): Counter => {
  const output = h('span');
  const element = h('span', { className: `number ${className}` }, output);
  let value: number | null = null;
  let frame = 0;

  const paint = (current: number) => {
    output.textContent = render(current);
  };

  const set = (next: number) => {
    if (next === value) return;
    cancelAnimationFrame(frame);
    const from = value;
    value = next;
    if (from === null || prefersReducedMotion()) return paint(next);
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      paint(Math.round(from + (next - from) * easeOutExpo(progress)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  return { element, set };
};
