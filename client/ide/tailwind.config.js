/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bloom-surface': 'var(--color-bloom-surface)',
        'bloom-border': 'var(--color-bloom-border)',
        'bloom-text-tertiary': 'var(--color-bloom-text-tertiary)',
        'bloom-text-primary': 'var(--color-bloom-text-primary)',
        'bloom-fill-secondary': 'var(--color-bloom-fill-secondary)',
      },
    },
  },
  plugins: [],
}
