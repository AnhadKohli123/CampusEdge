/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep navy surfaces, darkest at the page level and lifting toward the
        // foreground so cards read as raised without needing heavy borders.
        navy: {
          950: '#050a14',
          900: '#0a1120',
          850: '#0f1a30',
          800: '#152340',
          700: '#1d2f52',
          600: '#294169',
          500: '#375684',
        },
        // Text, cool grey-blue so it sits in the same family as the surfaces.
        ink: {
          50: '#eaf1ff',
          100: '#d5e2f8',
          200: '#b9cbec',
          300: '#9db3da',
          400: '#7e95bf',
          500: '#64789e',
        },
        accent: {
          300: '#8fb8ff',
          400: '#6ba1ff',
          500: '#4d8dff',
          600: '#3a76e8',
          700: '#2c5cba',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6)',
        glow: '0 0 0 1px rgba(77,141,255,.35), 0 8px 28px -8px rgba(77,141,255,.45)',
      },
      backgroundImage: {
        'navy-glow':
          'radial-gradient(1000px 600px at 15% -10%, rgba(77,141,255,.16), transparent 60%),' +
          'radial-gradient(800px 500px at 90% 0%, rgba(45,92,186,.14), transparent 55%)',
      },
    },
  },
  plugins: [],
};
