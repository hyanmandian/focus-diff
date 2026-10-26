import { defineContentScript } from '#imports';
import { mountBar } from '@/components/mount-bar/mount-bar';
import { github } from '@/utils/github-provider/github-provider';

export default defineContentScript({
  matches: github.matches,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main: (ctx) => mountBar(ctx, github),
});
