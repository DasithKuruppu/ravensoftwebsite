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
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
