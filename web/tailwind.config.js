/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				// Semantic tokens backed by the Nido theme engine (CSS variables in app.css).
				page: 'rgb(var(--c-page) / <alpha-value>)',
				surface: 'rgb(var(--c-surface) / <alpha-value>)',
				surface2: 'rgb(var(--c-surface2) / <alpha-value>)',
				ink: 'rgb(var(--c-ink) / <alpha-value>)',
				'ink-soft': 'rgb(var(--c-ink-soft) / <alpha-value>)',
				primary: 'rgb(var(--c-primary) / <alpha-value>)',
				'primary-hover': 'rgb(var(--c-primary-hover) / <alpha-value>)',
				'on-primary': 'rgb(var(--c-on-primary) / <alpha-value>)',
				accent: 'rgb(var(--c-accent) / <alpha-value>)',
				'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',
				'accent-soft': 'rgb(var(--c-accent-soft) / <alpha-value>)',
				line: 'rgb(var(--c-line) / <alpha-value>)',
				'line-soft': 'rgb(var(--c-line-soft) / <alpha-value>)',
				ok: {
					DEFAULT: 'rgb(var(--c-ok-bg) / <alpha-value>)',
					text: 'rgb(var(--c-ok-text) / <alpha-value>)',
					line: 'rgb(var(--c-ok-line) / <alpha-value>)',
				},
				danger: {
					DEFAULT: 'rgb(var(--c-danger-bg) / <alpha-value>)',
					text: 'rgb(var(--c-danger-text) / <alpha-value>)',
					line: 'rgb(var(--c-danger-line) / <alpha-value>)',
				},
			},
			fontFamily: {
				sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
				display: ['Lora', 'Georgia', 'serif'],
			},
			borderRadius: {
				'4xl': '2rem',
			},
			boxShadow: {
				soft: '0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.05)',
				card: '0 2px 12px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
			},
		},
	},
	plugins: [require('@tailwindcss/forms')],
};