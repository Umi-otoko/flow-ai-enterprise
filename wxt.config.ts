import { defineConfig } from 'wxt';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Flow AI Enterprise Generator',
    description: 'Automated mass generation of AI images for moodboards and ad campaigns',
    version: '2.0.0',
    permissions: ['scripting', 'activeTab', 'downloads', 'storage', 'alarms'],
  },
  vite: () => ({
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
  }),
});
