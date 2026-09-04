/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e4ff',
          500: '#4f6ef7',
          600: '#3b55d9',
          700: '#2f43ad',
        },
      },
    },
  },
  plugins: [],
};
