import type { Config } from 'tailwindcss';
import { tacPreset } from '@tac-ui/web/tailwind';
import { generateCSSVariables } from '@tac-ui/tokens/web';
import plugin from 'tailwindcss/plugin';

const tacThemePlugin = plugin(({ addBase }) => {
  const lightVars = generateCSSVariables('light');
  const darkVars = generateCSSVariables('dark');

  addBase({
    ':root': lightVars,
    '[data-theme="light"]': lightVars,
    '[data-theme="dark"]': darkVars,
    '@media (prefers-color-scheme: dark)': {
      ':root:not([data-theme="light"])': darkVars,
    },
    '*': {
      borderColor: 'var(--border)',
    },
    '*:not([data-no-bg-transition])': {
      transitionProperty: 'background-color, color, border-color, box-shadow',
      transitionDuration: 'var(--duration-normal)',
      transitionTimingFunction: 'var(--ease-standard)',
    },
    body: {
      backgroundColor: 'var(--background)',
      color: 'var(--foreground)',
      fontFamily: 'var(--font-primary), system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    },
  });
});

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@tac-ui/web/dist/**/*.{js,ts,jsx,tsx,mjs}',
  ],
  presets: [tacPreset],
  plugins: [tacThemePlugin],
};

export default config;
