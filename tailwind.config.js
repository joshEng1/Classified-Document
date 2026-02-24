/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['public/**/*.html', 'public/**/*.js', 'public/index.html', 'public/app.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
        ],
      },
      colors: {
        // Tuned for a neutral, enterprise dark theme.
        background: '#0A0A0A',
      },
    },
  },
  plugins: [],
};

