import { originOf, type AISettings } from '@/utils/ai';

/** Where GitHub serves `pull/N.diff`: it redirects to a separate host. */
export const GITHUB_DIFF_ORIGINS = ['https://github.com/*', 'https://patch-diff.githubusercontent.com/*'];

/** Hosts a guide needs: the provider and GitHub's diff download. */
export const guideOrigins = (settings: Pick<AISettings, 'provider' | 'baseUrl'>): string[] => [originOf(settings), ...GITHUB_DIFF_ORIGINS];
