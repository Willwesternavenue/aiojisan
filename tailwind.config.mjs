/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Design tokens — editorial calm palette
        background: '#FAFAF8',
        surface: '#FFFFFF',
        border: '#E5E5E0',
        text: {
          primary: '#1A1A18',
          secondary: '#6B6B65',
          muted: '#9B9B95',
        },
        accent: {
          DEFAULT: '#2D6A4F',
          light: '#EAF2EE',
        },
        // Status / score badges
        score: {
          high: '#1A6B3A',
          highBg: '#EAFAF0',
          mid: '#7A5C00',
          midBg: '#FDF6DC',
          low: '#8B1A1A',
          lowBg: '#FDF0EF',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'Hiragino Sans',
          'Hiragino Kaku Gothic ProN',
          'Noto Sans JP',
          'sans-serif',
        ],
        serif: [
          'Georgia',
          'Hiragino Mincho ProN',
          'Noto Serif JP',
          'serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        // Type scale
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.6' }],
        base: ['1rem', { lineHeight: '1.8' }],
        lg: ['1.125rem', { lineHeight: '1.7' }],
        xl: ['1.25rem', { lineHeight: '1.6' }],
        '2xl': ['1.5rem', { lineHeight: '1.4' }],
        '3xl': ['1.875rem', { lineHeight: '1.3' }],
        '4xl': ['2.25rem', { lineHeight: '1.2' }],
      },
      spacing: {
        // Spacing scale
        18: '4.5rem',
        22: '5.5rem',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      maxWidth: {
        prose: '68ch',
        admin: '1280px',
      },
    },
  },
  plugins: [],
};
