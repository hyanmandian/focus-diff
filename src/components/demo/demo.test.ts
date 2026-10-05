// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDemo } from './demo';
import { SAMPLE_PULL_REQUEST } from './sample';
import theme from '@/providers/github/theme.css?inline';

const mount = () => {
  const target = document.createElement('div');
  document.body.append(target);
  const onSettings = vi.fn();
  const { destroy } = createDemo(target, structuredClone(SAMPLE_PULL_REQUEST), { onSettings, theme });
  const root = target.shadowRoot!;
  const bar = root.querySelector('.demo-bar')!.shadowRoot!;
  const shown = () => root.querySelectorAll('.demo-file:not([data-out])').length;
  const option = (id: string) => bar.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
  return { root, bar, shown, option, onSettings, destroy };
};

describe('createDemo', () => {
  it('filters the sample pull request with the real bar', () => {
    const { shown, option } = mount();
    expect(shown()).toBe(12);
    option('frontend').click();
    expect(shown()).toBe(3);
    option('backend').click();
    expect(shown()).toBe(6);
    option('all').click();
    expect(shown()).toBe(12);
  });

  it('counts a file off when it is marked as viewed', () => {
    const { root, bar } = mount();
    const left = () => bar.querySelector('.files-count')?.textContent;
    expect(left()).toBe('9');
    root.querySelector<HTMLButtonElement>('.demo-viewed[aria-pressed="false"]')!.click();
    expect(left()).toBe('8');
  });

  it('hands the settings button to the page, and takes itself down', () => {
    const { root, bar, onSettings, destroy } = mount();
    bar.querySelector<HTMLButtonElement>('.settings')!.click();
    expect(onSettings).toHaveBeenCalledOnce();
    destroy();
    expect(root.childElementCount).toBe(0);
  });
});
