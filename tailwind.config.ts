import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7f0',
          100: '#dcebdc',
          500: '#2e7d32',
          600: '#276b2b',
          700: '#1f5622',
          800: '#183f1a',
          900: '#102b12',
        },
      },
    },
  },
  plugins: [],
};
export default config;
