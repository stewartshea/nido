<script lang="ts">
	import { Drawer } from 'vaul-svelte';
	import { X } from 'lucide-svelte';

	export let open = false;
	export let title = '';

	function handleClose() {
		open = false;
	}
</script>

<Drawer.Root bind:open shouldScaleBackground>
	<Drawer.Portal>
		<Drawer.Overlay class="fixed inset-0 bg-black/40 z-50" />
		<Drawer.Content class="bg-surface flex flex-col rounded-t-[28px] mt-24 h-fit max-h-[96%] fixed bottom-0 left-0 right-0 z-50 outline-none">
			<div class="p-4 bg-surface rounded-t-[28px] flex-1 overflow-y-auto">
				<div class="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-line mb-6" />
				<div class="flex items-center justify-between mb-4">
					<Drawer.Title class="text-xl font-display font-semibold">{title}</Drawer.Title>
					<button type="button" on:click={handleClose} class="p-2 rounded-full hover:bg-surface2 text-ink-soft hover:text-ink">
						<X class="w-5 h-5" />
					</button>
				</div>
				<div class="pb-8">
					<slot />
				</div>
			</div>
		</Drawer.Content>
	</Drawer.Portal>
</Drawer.Root>
