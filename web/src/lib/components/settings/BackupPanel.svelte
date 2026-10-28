<script lang="ts">
	import { notify, fail } from '$lib/stores/feedback';
	import { familyAdminAPI } from '$lib/api/system';

	/**
	 * The Backup tab: the sanctioned bulk way out (export) and back in
	 * (restore). Export is passed in because the profile tab offers the same
	 * download; a successful restore asks the page to reload its data.
	 */
	export let activeFamily: any = null;
	export let activeFamilyId: string | null = null;
	/** Page-level export — one concern shared with the profile tab. */
	export let exportFamily: () => void = () => {};
	/** The page's loadFamilies, called after a restore lands. */
	export let dataChanged: () => Promise<void> | void = () => {};

	let backupFile: File | null = null;
	let restoring = false;

	function onBackupFileSelected() {
		const input = document.getElementById('backup-file') as HTMLInputElement | null;
		backupFile = input?.files?.[0] ?? null;
	}

	async function restoreBackup() {
		if (!activeFamilyId || !backupFile) {
			fail('Choose a Nido backup file first.');
			return;
		}
		if (!confirm('Restore this backup into your family? Existing members are matched by name and skipped; records will be re-added.')) return;
		restoring = true;
		try {
			const text = await backupFile.text();
			const json = JSON.parse(text);
			const res = await familyAdminAPI.restore(activeFamilyId, json);
			notify(`${res.data.message}. Members added: ${res.data.membersAdded}.`);
			backupFile = null;
			await dataChanged();
		} catch (err: any) {
			fail(err.response?.data?.error || (err instanceof SyntaxError ? 'Not a valid JSON backup file.' : 'Restore failed.'));
		} finally {
			restoring = false;
		}
	}
</script>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
	<h3 class="text-lg font-display font-semibold mb-2">Backup</h3>
	<p class="text-ink-soft text-sm mb-4">Download a full backup of <span class="text-ink font-medium">{activeFamily?.name}</span> — every member, all records (feeds, diapers, sleep, growth, milestones, vaccinations), formulas, tracked-category settings, and pending invitations — as a portable JSON file. Restore it later into this family.</p>

	<div class="flex flex-col gap-4">
		<button type="button" on:click={exportFamily} class="bg-primary text-on-primary px-4 py-2.5 rounded-md hover:bg-primary">⬇ Download all-data backup</button>

		<div class="border-t border-line-soft pt-4">
			<h4 class="font-display font-semibold text-sm mb-2">Restore from backup</h4>
			<p class="text-xs text-ink-soft mb-2">Choose a Nido backup JSON file. Members already present (matched by name) are skipped; their records will be re-added from the backup.</p>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<input id="backup-file" type="file" accept=".json,application/json" on:change={onBackupFileSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
				<button type="button" disabled={restoring || !backupFile} on:click={restoreBackup} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50 shrink-0">
					{restoring ? 'Restoring...' : 'Restore'}
				</button>
			</div>
		</div>

		<div class="border-t border-line-soft pt-4 bg-surface2 rounded-md p-4">
			<h4 class="font-display font-semibold text-sm mb-2">Restore notes</h4>
			<ul class="text-xs text-ink-soft list-disc ml-4 space-y-1">
				<li>Backups are per-family. Download each family&rsquo;s backup separately from that family&rsquo;s account.</li>
				<li>To restore into a different family, switch to (or create) that family in Account → Family, then Restore here.</li>
				<li>Restore is additive: existing members are matched by name and skipped, and their records are appended. To fully replace data, delete the family first (owner only), rebuild it, then restore.</li>
				<li>Restoring to a brand-new family requires the restore file&rsquo;s members to be added first — it will create them automatically.</li>
			</ul>
		</div>
	</div>
</div>
