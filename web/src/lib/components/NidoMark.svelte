<script lang="ts">
	/**
	 * The product mark: an egg in a nest.
	 *
	 * The same geometry as the app icon (`web/static/favicon.svg`) and the
	 * site crest, drawn in `currentColor` so it follows the active theme like
	 * every other glyph. The kanji 巣 remains the project's editorial crest
	 * (README, docs); this is the mark the installed app wears, because a
	 * glyph that dense does not survive sixteen pixels.
	 */
	export let size = 24;
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="block shrink-0">
	<!-- the egg -->
	<path
		d="M16 7.8c3.5 0 6.3 4 6.3 8.1 0 3.2-2.8 5.1-6.3 5.1s-6.3-1.9-6.3-5.1c0-4.1 2.8-8.1 6.3-8.1z"
		fill="currentColor"
	/>
	<!-- the nest -->
	<path
		d="M6.5 18.5C8.5 22 23.5 22 25.5 18.5"
		fill="none"
		stroke="currentColor"
		stroke-width="3.4"
		stroke-linecap="round"
	/>
</svg>
