import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mrchristianharms-byte.github.io',
  base: '/retroKompott',
  outDir: './docs',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
