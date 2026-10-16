<script lang="ts">
	import { Drawer } from 'vaul-svelte';
	import { X } from 'lucide-svelte';

	export let open = false;
	export let title = '';

	function handleClose() {
		open = false;
	}
</script>

<!--
	`dismissible={false}` keeps a swipe-down or a tap on the dimmed page from
	closing the sheet. Those gestures used to throw away whatever was half
	typed in the form (and hid a running timer mid-recording). Closing is
	deliberate: the X button, or Escape on a keyboard.
-->
<Drawer.Root bind:open shouldScaleBackground dismissible={false}>
	<Drawer.Portal>
		<Drawer.Overlay class="fixed inset-0 bg-black/40 z-50" />
		<!--
			Sized to its content and capped at 92% of the *visible* viewport.
			A fixed `height: 96vh` left a slab of empty sheet under short forms
			(the feed kind chooser is ~366px tall in an ~810px sheet), and `vh`
			on mobile tracks the large viewport, so with the URL bar showing the
			top of the sheet (handle, title, close) could end up off-screen.
			`dvh` follows the visible viewport instead; the `vh` line is the
			fallback for browsers without dynamic viewport units.
		-->
		<Drawer.Content
			class="bg-surface flex flex-col rounded-t-[28px] fixed bottom-0 left-0 right-0 z-50 outline-none"
			style="max-height: 92vh; max-height: 92dvh;"
		>
			<div class="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-surface rounded-t-[28px] flex-1 min-h-0 overflow-y-auto">
				<div class="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-line mb-6" />
				<div class="flex items-center justify-between mb-4">
					<Drawer.Title class="text-xl font-display font-semibold">{title}</Drawer.Title>
					<button type="button" on:click={handleClose} aria-label="Close" class="h-11 w-11 -mr-1 flex items-center justify-center rounded-full hover:bg-surface2 text-ink-soft hover:text-ink">
						<X class="w-5 h-5" />
					</button>
				</div>
				<div class="pb-2">
					<slot />
				</div>
			</div>
		</Drawer.Content>
	</Drawer.Portal>
</Drawer.Root>
