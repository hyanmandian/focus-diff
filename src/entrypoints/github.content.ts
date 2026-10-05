import { defineContentScript } from '#imports';
import { mountBar } from '@/content/mount';
import { github } from '@/providers/github/github';

export default defineContentScript({
  matches: github.matches,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main: (ctx) => mountBar(ctx, github),
});
