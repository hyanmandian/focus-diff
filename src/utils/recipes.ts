export interface RecipeFilter {
  name: string;
  include: string;
  exclude: string;
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  filters: RecipeFilter[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'stack',
    title: 'recipeStackTitle',
    description: 'recipeStackDescription',
    filters: [
      { name: 'recipeStackFrontend', include: '\\.(tsx?|jsx?|vue|svelte|css|scss)$', exclude: '\\.(test|spec|stories)\\.' },
      { name: 'recipeStackBackend', include: '\\.(py|go|rb|java|kt|cs|php|rs|ex)$', exclude: '(^|/)(tests?|spec)/|_test\\.|Test\\.' },
    ],
  },
  {
    id: 'area',
    title: 'recipeAreaTitle',
    description: 'recipeAreaDescription',
    filters: [{ name: 'recipeAreaName', include: '^(apps|packages|services)/payments/', exclude: '' }],
  },
  {
    id: 'tests',
    title: 'recipeTestsTitle',
    description: 'recipeTestsDescription',
    filters: [
      { name: 'recipeTestsCode', include: '', exclude: '\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/' },
      { name: 'recipeTestsOnly', include: '\\.(test|spec)\\.|(^|/)(tests?|__tests__)/', exclude: '' },
    ],
  },
  {
    id: 'generated',
    title: 'recipeGeneratedTitle',
    description: 'recipeGeneratedDescription',
    filters: [
      {
        name: 'recipeGeneratedName',
        include: '',
        exclude:
          '(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|poetry\\.lock|go\\.sum)$|\\.snap$|\\.min\\.(js|css)$|(^|/)(dist|build|generated|__generated__)/',
      },
    ],
  },
  {
    id: 'infra',
    title: 'recipeInfraTitle',
    description: 'recipeInfraDescription',
    filters: [
      {
        name: 'recipeInfraName',
        include: '(^|/)(\\.github|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$',
        exclude: '',
      },
    ],
  },
  {
    id: 'database',
    title: 'recipeDatabaseTitle',
    description: 'recipeDatabaseDescription',
    filters: [{ name: 'recipeDatabaseName', include: '(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$', exclude: '' }],
  },
  {
    id: 'docs',
    title: 'recipeDocsTitle',
    description: 'recipeDocsDescription',
    filters: [{ name: 'recipeDocsName', include: '\\.(mdx?|rst|txt)$|(^|/)docs/', exclude: '' }],
  },
];
