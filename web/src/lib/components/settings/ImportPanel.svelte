<script lang="ts">
	import { notify, fail } from '$lib/stores/feedback';
	import { importsAPI } from '$lib/api/system';
	import { zonedOptions } from '$lib/logging/format';

	/**
	 * The Import tab: bring history in from another baby app as a run that can
	 * be undone. The run history itself is page state passed in (`runs`) — the
	 * page loads it once with the rest of the family data, so opening this tab
	 * re-renders it without a refetch. Everything an import mutates lives here.
	 */
	export let profiles: any[] = [];
	export let activeFamily: any = null;
	/** Import runs, loaded by the page's loadFamilies alongside the family data. */
	export let runs: any[] = [];
	/** The page's loadFamilies — reloads family data after a run lands or is undone. */
	export let dataChanged: () => Promise<void> | void = () => {};

	let importFile: File | null = null;
	let importResult: any = null;
	let importing = false;
	let importTargetBabyId: number | null = null;
	let importType: 'narababy' | 'csv' = 'narababy';
	let undoingRunId: number | null = null;

	function formatTime(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString(undefined, zonedOptions({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
	}

	function onImportFileSelected() {
		const input = document.getElementById('import-file') as HTMLInputElement | null;
		importFile = input?.files?.[0] ?? null;
		importResult = null;
	}

	async function importNarababy() {
		fail('');
		if (!importFile) {
			fail('Choose a Narababy export file first.');
			return;
		}
		importing = true;
		importResult = null;
		try {
			const res = await importsAPI.narababy(importFile, importTargetBabyId, importType);
			importResult = res.data;
			notify(res.data.message || 'Import complete.');
			await dataChanged();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Import failed.');
			console.error(err);
		} finally {
			importing = false;
		}
	}

	async function undoImportRun(runId: number) {
		if (!confirm('Undo this import? Records created by it will be deleted.')) return;
		undoingRunId = runId;
		try {
			const res = await importsAPI.undoRun(runId);
			notify(res.data.message || 'Import undone.');
			await dataChanged();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to undo import.');
		} finally {
			undoingRunId = null;
		}
	}
</script>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
	<h3 class="text-lg font-display font-semibold mb-2">Import data</h3>
	<p class="text-ink-soft text-sm mb-3">Bring history from another baby app into {activeFamily?.name}. Records land on the selected family member. Re-importing the same file skips duplicates.</p>
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
		<div class="flex-1">
			<label for="import-target" class="block text-sm font-medium text-ink-soft mb-1">Assign to family member</label>
			<select id="import-target" bind:value={importTargetBabyId} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
				<option value={null}>— choose a member —</option>
				{#each profiles as baby}
					<option value={baby.id}>{baby.name}</option>
				{/each}
			</select>
		</div>
		<div class="flex-1">
			<label for="import-type" class="block text-sm font-medium text-ink-soft mb-1">Import type</label>
			<select id="import-type" bind:value={importType} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
				<option value="narababy">Narababy (CSV)</option>
				<option value="csv">Generic CSV</option>
			</select>
		</div>
		<div class="flex-1">
			<label for="import-file" class="block text-sm font-medium text-ink-soft mb-1">File</label>
			<input id="import-file" type="file" accept=".csv,text/csv" on:change={onImportFileSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
			{#if importFile}
				<p class="text-xs text-ink-soft mt-1">Selected: {importFile.name}</p>
			{/if}
		</div>
		<div class="sm:self-end">
			<button type="button" disabled={importing || !importFile} on:click={importNarababy} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50">
				{importing ? 'Importing...' : 'Import'}
			</button>
		</div>
	</div>
	{#if importResult}
		<div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
			<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Feedings</span><br /><span class="font-semibold text-ink">{importResult.created?.feedings ?? 0}</span></div>
			<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Diapers</span><br /><span class="font-semibold text-ink">{importResult.created?.diapers ?? 0}</span></div>
			<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Sleep</span><br /><span class="font-semibold text-ink">{importResult.created?.sleep ?? 0}</span></div>
			<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Growth</span><br /><span class="font-semibold text-ink">{importResult.created?.growth ?? 0}</span></div>
			<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Milestones</span><br /><span class="font-semibold text-ink">{importResult.created?.milestones ?? 0}</span></div>
			<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Skipped (dups)</span><br /><span class="font-semibold text-ink">{importResult.skippedDuplicate ?? 0}</span></div>
		</div>
		{#if importResult.errors && importResult.errors.length > 0}
			<p class="text-xs text-danger-text mt-2">{importResult.errors.length} row(s) had issues.</p>
		{/if}
	{/if}
	{#if runs.length > 0}
		<div class="border-t border-line-soft pt-3 mt-4">
			<h4 class="font-display font-semibold text-sm mb-2">Import history</h4>
			<ul class="divide-y divide-line-soft">
				{#each runs as run}
					<li class="py-2 flex items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="text-sm text-ink truncate">{run.filename || 'Import'}</p>
							<p class="text-xs text-ink-soft">{formatTime(run.createdAt)} · {run.importType}{run.memberId ? ` · member #${run.memberId}` : ''}</p>
						</div>
						<button type="button" disabled={undoingRunId === run.id} on:click={() => undoImportRun(run.id)} class="text-xs text-danger-text hover:underline shrink-0">
							{undoingRunId === run.id ? 'Undoing...' : 'Undo'}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
