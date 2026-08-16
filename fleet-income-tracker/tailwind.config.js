/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0c10',
          900: '#0f1218',
          850: '#141821',
          800: '#1b2029',
          700: '#262c38',
          600: '#3a4150',
        },
        accent: {
          DEFAULT: '#4ade80',
          dim: '#22c55e',
        },
        warn: '#fbbf24',
        danger: '#f87171',
      },
      /* Inter and the monospace faces carry no Sinhala glyphs, so both stacks
         fall through to whatever Sinhala font the device has: Noto Sans Sinhala
         on Android and modern Linux, Nirmala UI on Windows, and the system
         fallback on iOS. No webfont is shipped — a Sinhala face is upwards of
         200 KB, and this is a page a driver opens on mobile data.
         The Sinhala fallback sits on the mono stack too: the `num` class is on
         several hint lines that carry words as well as figures. */
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'JetBrains Mono',
          'Menlo',
          'Consolas',
          'Noto Sans Sinhala',
          'Nirmala UI',
          'monospace',
        ],
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          'Noto Sans Sinhala',
          'Nirmala UI',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
