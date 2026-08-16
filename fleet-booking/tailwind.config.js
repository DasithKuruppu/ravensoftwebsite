/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /* A light, quiet palette. This is a page a stranger lands on once, on a
           phone, deciding whether to trust it with a trip — the opposite brief
           from the tracker's dark operator console. */
        paper: '#ffffff',
        canvas: '#f7f7f5',
        line: '#e6e5e0',
        ink: {
          900: '#16181d',
          700: '#3d424b',
          500: '#6b7280',
          400: '#9aa0a8',
        },
        brand: {
          DEFAULT: '#0f6f4f',
          dark: '#0b573e',
          soft: '#e7f2ed',
        },
        warn: '#b45309',
        danger: '#b91c1c',
      },
      fontFamily: {
        /* Inter carries no Sinhala glyphs, so both stacks fall through to
           whatever the device has: Noto Sans Sinhala on Android and modern
           Linux, Nirmala UI on Windows, the system fallback on iOS. No webfont
           is shipped — a Sinhala face is upwards of 200 KB, and this is a page
           opened once on mobile data. */
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Noto Sans Sinhala', 'Nirmala UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      maxWidth: {
        form: '34rem',
      },
    },
  },
  plugins: [],
};
