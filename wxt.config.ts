import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/i18n/module'],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    homepage_url: 'https://github.com/hyanmandian/focus-diff',
    permissions: ['storage'],
    action: { default_title: '__MSG_actionTitle__' },
    minimum_chrome_version: '102',
    commands: {
      'next-filter': { suggested_key: { default: 'Alt+Shift+Period' }, description: '__MSG_commandNext__' },
      'previous-filter': { suggested_key: { default: 'Alt+Shift+Comma' }, description: '__MSG_commandPrevious__' },
      'show-all': { suggested_key: { default: 'Alt+Shift+0' }, description: '__MSG_commandAll__' },
    },
    ...(browser === 'firefox'
      ? {
          author: 'Hyan Mandian',
          browser_specific_settings: {
            gecko: {
              id: 'focus-diff@hyan.com.br',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : { author: { email: 'contact@hyan.com.br' } }),
  }),
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
    excludeSources: ['store/**'],
  },
});
