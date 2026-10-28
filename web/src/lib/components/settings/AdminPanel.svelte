<script lang="ts">
	import { onMount } from 'svelte';
	import { notify, fail } from '$lib/stores/feedback';
	import { settingsAPI } from '$lib/api/system';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import type { ComponentStatus, SystemOverview, RegistryView } from '$lib/api/types';

	/**
	 * The Admin tab: instance settings (sign-up, email verification, SMTP) and
	 * the read-only system status and registry views. The page only mounts this
	 * for platform admins (its isPanelAdmin gate), so everything loads here,
	 * when the tab opens — the same refresh the admin row's click used to do.
	 */
	export let isAdmin = true;

	// Instance settings (Admin tab)
	let appSettings: any = null;
	let savingSettings = false;
	let testingSmtp = false;
	let smtpHost = '';
	let smtpPort = 587;
	let smtpUser = '';
	let smtpPass = '';
	let smtpFrom = '';
	let signupEnabled = true;
	let signupEnvLocked = false;
	let emailVerificationSetting = false;

	// Instance health / roll-up stats for the Admin tab.
	let systemOverview: SystemOverview | null = null;
	let loadingOverview = false;
	let overviewError = '';

	// Formatting lives here too rather than being sent pre-rendered for the
	// tiles; the component metrics arrive as strings from the API.
	function formatBytes(bytes: number | null | undefined): string {
		if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
		if (bytes < 1024) return `${Math.round(bytes)} B`;
		const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
		let value = bytes / 1024;
		let i = 0;
		while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
		return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
	}

	function formatDuration(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '—';
		const s = Math.floor(seconds);
		const d = Math.floor(s / 86_400);
		const h = Math.floor((s % 86_400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		if (m > 0) return `${m}m ${s % 60}s`;
		return `${s}s`;
	}

	function statusDot(status: ComponentStatus): string {
		return status === 'ok' ? 'bg-ok-text' : status === 'warn' ? 'bg-accent' : 'bg-danger-text';
	}
	function statusText(status: ComponentStatus): string {
		return status === 'ok' ? 'text-ok-text' : status === 'warn' ? 'text-ink-soft' : 'text-danger-text';
	}
	function statusLabel(status: ComponentStatus): string {
		return status === 'ok' ? 'OK' : status === 'warn' ? 'Attention' : 'Down';
	}

	$: overviewTiles = systemOverview
		? [
			{ label: 'Families', value: String(systemOverview.rollup.activeFamilies), hint: systemOverview.rollup.orphanedFamilies > 0 ? `${systemOverview.rollup.orphanedFamilies} retained · no accounts` : 'all with accounts' },
			{ label: 'Accounts', value: String(systemOverview.rollup.accounts), hint: `${systemOverview.rollup.platformAdmins} platform admin${systemOverview.rollup.platformAdmins === 1 ? '' : 's'}` },
			{ label: 'Family databases', value: String(systemOverview.rollup.familyDbFiles), hint: formatBytes(systemOverview.rollup.familyDbBytes) },
			{ label: 'Registry size', value: formatBytes(systemOverview.rollup.registryBytes), hint: 'control plane' },
			{ label: 'Attachments', value: systemOverview.rollup.attachmentFiles.toLocaleString(), hint: formatBytes(systemOverview.rollup.attachmentBytes) },
			{ label: 'Disk free', value: formatBytes(systemOverview.rollup.diskFreeBytes), hint: systemOverview.rollup.diskTotalBytes ? `of ${formatBytes(systemOverview.rollup.diskTotalBytes)}` : 'data volume' },
			{ label: 'Uptime', value: formatDuration(systemOverview.instance.uptimeSeconds), hint: `PID ${systemOverview.instance.pid}` },
			{ label: 'Memory (RSS)', value: formatBytes(systemOverview.instance.memoryRssBytes), hint: `heap ${formatBytes(systemOverview.instance.memoryHeapUsedBytes)}` },
		]
		: [];

	async function loadSystemOverview() {
		loadingOverview = true;
		overviewError = '';
		try {
			const res = await settingsAPI.overview();
			systemOverview = res.data.overview;
		} catch (err: any) {
			systemOverview = null;
			overviewError = err.response?.data?.error || 'Could not load system status.';
		} finally {
			loadingOverview = false;
		}
	}

	// Read-only registry view for the Admin tab.
	let registryView: RegistryView | null = null;
	let loadingRegistry = false;
	let registryError = '';

	// A family with no routed accounts is a namespace that was retained when its
	// last account joined another family. It is not a live family, so it is
	// counted and shown separately rather than inflating the family list.
	$: registryActiveFamilies = registryView ? registryView.families.filter((f) => f.accountCount > 0).length : 0;
	$: registryRetainedFamilies = registryView ? registryView.families.length - registryActiveFamilies : 0;

	function fmtDate(iso: string): string {
		if (!iso) return '—';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	async function loadRegistry() {
		loadingRegistry = true;
		registryError = '';
		try {
			const res = await settingsAPI.registry();
			registryView = res.data.registry;
		} catch (err: any) {
			registryView = null;
			registryError = err.response?.data?.error || 'Could not load the registry.';
		} finally {
			loadingRegistry = false;
		}
	}

	async function loadAppSettings() {
		try {
			const res = await settingsAPI.get();
			appSettings = res.data.settings;
			smtpHost = appSettings.smtpHost || '';
			smtpPort = appSettings.smtpPort || 587;
			smtpUser = appSettings.smtpUser || '';
			smtpFrom = appSettings.smtpFrom || '';
			signupEnabled = appSettings.signupEnabled;
			signupEnvLocked = appSettings.signupEnvLocked === true;
			emailVerificationSetting = appSettings.emailVerification;
		} catch {
			appSettings = null;
		}
	}

	async function saveAppSettings() {
		savingSettings = true;
		fail('');
		try {
			const res = await settingsAPI.update({
				signupEnabled,
				emailVerification: emailVerificationSetting,
				smtpHost: smtpHost || null,
				smtpPort: smtpPort || null,
				smtpUser: smtpUser || null,
				smtpPass: smtpPass || null,
				smtpFrom: smtpFrom || null,
			});
			appSettings = res.data.settings;
			notify('Settings saved.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to save settings.');
		} finally {
			savingSettings = false;
		}
	}

	async function testSmtp() {
		testingSmtp = true;
		fail('');
		try {
			const res = await settingsAPI.test();
			notify(res.data.message || 'Test email sent.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Test failed.');
		} finally {
			testingSmtp = false;
		}
	}

	onMount(() => {
		if (!isAdmin) return;
		void loadAppSettings();
		void loadSystemOverview();
		void loadRegistry();
	});
</script>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
	<div class="flex items-start justify-between gap-3 mb-4">
		<div>
			<h3 class="text-lg font-display font-semibold">System status</h3>
			<p class="text-ink-soft text-sm">Roll-up of this instance: accounts, storage, and the health of each component.</p>
		</div>
		<button type="button" on:click={loadSystemOverview} disabled={loadingOverview} class="bg-surface2 text-ink-soft px-3 py-2 rounded-md hover:text-ink disabled:opacity-50 text-sm min-h-[36px] shrink-0">
			{loadingOverview ? 'Refreshing…' : 'Refresh'}
		</button>
	</div>

	{#if overviewError}
		<div class="bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm">{overviewError}</div>
	{:else if !systemOverview}
		<p class="text-ink-soft text-sm">Loading system status…</p>
	{:else}
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-5" data-testid="admin-stats">
			{#each overviewTiles as tile (tile.label)}
				<div class="rounded-lg border border-line-soft bg-surface px-3 py-2.5">
					<p class="text-xs text-ink-soft leading-tight">{tile.label}</p>
					<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{tile.value}</p>
					<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{tile.hint}</p>
				</div>
			{/each}
		</div>

		<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Components</h4>
		<div class="flex flex-col divide-y divide-line-soft border border-line-soft rounded-lg overflow-hidden">
			{#each systemOverview.components as cmp (cmp.key)}
				<div class="p-3 flex flex-col gap-2">
					<div class="flex items-start gap-2">
						<span class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 {statusDot(cmp.status)}" aria-hidden="true"></span>
						<div class="flex-1 min-w-0">
							<div class="flex flex-wrap items-baseline gap-x-2">
								<span class="font-medium text-ink">{cmp.name}</span>
								<span class="text-xs font-semibold {statusText(cmp.status)}">{statusLabel(cmp.status)}</span>
							</div>
							<p class="text-sm text-ink-soft break-words">{cmp.summary}</p>
						</div>
					</div>
					{#if cmp.usagePct !== null}
						<div class="h-1.5 rounded-full bg-surface2 overflow-hidden ml-[18px]" aria-hidden="true">
							<div class="h-full {statusDot(cmp.status)}" style={`width: ${Math.min(100, Math.max(0, cmp.usagePct))}%`}></div>
						</div>
					{/if}
					<div class="flex flex-wrap gap-x-4 gap-y-1 ml-[18px]">
						{#each cmp.metrics as m (m.label)}
							<span class="text-xs text-ink-soft">{m.label}: <span class="text-ink">{m.value}</span></span>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<p class="text-[11px] text-ink-soft mt-3 break-words">
			Node {systemOverview.instance.node} · {systemOverview.instance.platform} · host {systemOverview.instance.hostname} · PID {systemOverview.instance.pid} · data {systemOverview.instance.dataDir}
		</p>
	{/if}
</div>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
	<div class="flex items-start justify-between gap-3 mb-4">
		<div>
			<h3 class="text-lg font-display font-semibold">Registry</h3>
			<p class="text-ink-soft text-sm">Read-only rows of the instance control plane: families, accounts, settings, scheduler leases. Secrets and reset tokens are never shown.</p>
		</div>
		<button type="button" on:click={loadRegistry} disabled={loadingRegistry} class="bg-surface2 text-ink-soft px-3 py-2 rounded-md hover:text-ink disabled:opacity-50 text-sm min-h-[36px] shrink-0">
			{loadingRegistry ? 'Refreshing…' : 'Refresh'}
		</button>
	</div>

	{#if registryError}
		<div class="bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm">{registryError}</div>
	{:else if !registryView}
		<p class="text-ink-soft text-sm">Loading registry…</p>
	{:else}
		<div class="space-y-5">
			<section>
				<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Instance settings</h4>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 rounded-lg border border-line-soft p-3 text-sm">
					<div><span class="text-ink-soft text-xs block">Sign-up</span><span class="text-ink">{registryView.settings.signupEnabled ? 'Open' : 'Closed'}{registryView.settings.signupEnvLocked ? ' (env-locked)' : ''}</span></div>
					<div><span class="text-ink-soft text-xs block">Email verification</span><span class="text-ink">{registryView.settings.emailVerification ? 'Required' : 'Off'}</span></div>
					<div><span class="text-ink-soft text-xs block">SMTP</span><span class="text-ink">{registryView.settings.smtpConfigured ? `${registryView.settings.smtpHost}:${registryView.settings.smtpPort}` : 'Not configured'}</span></div>
					<div><span class="text-ink-soft text-xs block">From</span><span class="text-ink break-words">{registryView.settings.smtpFrom || 'default'}</span></div>
					<div><span class="text-ink-soft text-xs block">SMTP credentials</span><span class="text-ink">user {registryView.settings.smtpUserSet ? 'set' : 'unset'} · password {registryView.settings.smtpPassSet ? 'set' : 'unset'}</span></div>
					<div><span class="text-ink-soft text-xs block">Updated</span><span class="text-ink">{fmtDate(registryView.settings.updatedAt)}</span></div>
				</div>
			</section>

			<section>
				<div class="flex flex-wrap items-baseline gap-x-2">
					<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Families ({registryActiveFamilies})</h4>
					{#if registryRetainedFamilies > 0}
						<span class="text-[11px] text-ink-soft">+ {registryRetainedFamilies} retained without accounts</span>
					{/if}
				</div>
				{#if registryRetainedFamilies > 0}
					<p class="text-xs text-ink-soft mt-1 mb-2">
						A retained family has no accounts left — the account that owned it joined another family, and its data was kept rather than deleted. Retained families are excluded from the family count and skipped by the notification scheduler.
					</p>
				{/if}
				{#if registryView.families.length === 0}
					<p class="text-ink-soft text-sm">No families provisioned yet.</p>
				{:else}
					<div class="overflow-x-auto rounded-lg border border-line-soft">
						<table class="w-full text-sm min-w-[560px]">
							<thead>
								<tr class="text-left text-xs text-ink-soft bg-surface2">
									<th class="px-3 py-2 font-semibold">Family</th>
									<th class="px-3 py-2 font-semibold">Name</th>
									<th class="px-3 py-2 font-semibold">Code</th>
									<th class="px-3 py-2 font-semibold">Accounts</th>
									<th class="px-3 py-2 font-semibold">Created</th>
								</tr>
							</thead>
							<tbody>
								{#each registryView.families as fam (fam.familyId)}
								<tr class="border-t border-line-soft">
									<td class="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">{fam.familyId}</td>
									<td class="px-3 py-2 text-ink whitespace-nowrap">{fam.name}</td>
									<td class="px-3 py-2 font-mono text-xs text-ink-soft whitespace-nowrap">{fam.familyCode || '—'}</td>
									<td class="px-3 py-2 whitespace-nowrap">
										{#if fam.accountCount > 0}
											<span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-ok-text" aria-hidden="true"></span><span class="text-ink">{fam.accountCount}</span></span>
										{:else}
											<span class="inline-flex items-center rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-ink-soft">none · retained</span>
										{/if}
									</td>
									<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(fam.createdAt)}</td>
								</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>

			<section>
				<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Accounts ({registryView.users.length})</h4>
				{#if registryView.users.length === 0}
					<p class="text-ink-soft text-sm">No accounts yet.</p>
				{:else}
					<div class="overflow-x-auto rounded-lg border border-line-soft">
						<table class="w-full text-sm min-w-[560px]">
							<thead>
								<tr class="text-left text-xs text-ink-soft bg-surface2">
									<th class="px-3 py-2 font-semibold">Email</th>
									<th class="px-3 py-2 font-semibold">Role</th>
									<th class="px-3 py-2 font-semibold">Admin</th>
									<th class="px-3 py-2 font-semibold">Family</th>
									<th class="px-3 py-2 font-semibold">Created</th>
								</tr>
							</thead>
							<tbody>
								{#each registryView.users as usr (usr.userId + usr.familyId)}
								<tr class="border-t border-line-soft">
									<td class="px-3 py-2 text-ink whitespace-nowrap">{usr.email}</td>
									<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{usr.role}</td>
									<td class="px-3 py-2 whitespace-nowrap">{#if usr.isPlatformAdmin}<span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-ok-text" aria-hidden="true"></span><span class="text-ink">platform admin</span></span>{:else}<span class="text-ink-soft">—</span>{/if}</td>
									<td class="px-3 py-2 font-mono text-xs text-ink-soft whitespace-nowrap">{usr.familyId}</td>
									<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(usr.createdAt)}</td>
								</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>

			{#if registryView.leases.length > 0}
			<section>
				<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Scheduler leases ({registryView.leases.length})</h4>
				<div class="overflow-x-auto rounded-lg border border-line-soft">
					<table class="w-full text-sm min-w-[480px]">
						<thead>
							<tr class="text-left text-xs text-ink-soft bg-surface2">
								<th class="px-3 py-2 font-semibold">Job</th>
								<th class="px-3 py-2 font-semibold">Holder</th>
								<th class="px-3 py-2 font-semibold">Acquired</th>
								<th class="px-3 py-2 font-semibold">Expires</th>
							</tr>
						</thead>
						<tbody>
							{#each registryView.leases as lease (lease.name)}
							<tr class="border-t border-line-soft">
								<td class="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">{lease.name}</td>
								<td class="px-3 py-2 font-mono text-xs text-ink-soft whitespace-nowrap">{lease.holder}</td>
								<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(lease.acquiredAt)}</td>
								<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(lease.expiresAt)}</td>
							</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
			{/if}
		</div>
	{/if}
</div>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
	<h3 class="text-lg font-display font-semibold mb-2">Admin</h3>
	<p class="text-ink-soft text-sm mb-4">Instance-wide settings. These apply to every family on this server.</p>

	<div class="flex flex-col gap-4">
		<div class="border-t border-line-soft pt-4">
			<h4 class="font-display font-semibold text-sm mb-2">Sign up</h4>
			<ToggleSwitch
				checked={signupEnabled}
				disabled={signupEnvLocked}
				label="Allow new account sign up"
				description="When off, the register page is blocked for new accounts."
				onToggle={() => { signupEnabled = !signupEnabled; saveAppSettings(); }}
			/>
			{#if signupEnvLocked}
				<p class="text-xs text-ink-soft mt-2">Controlled by the <span class="font-mono">SIGNUP_ENABLED</span> environment variable — this toggle is locked.</p>
			{/if}
			<ToggleSwitch
				checked={emailVerificationSetting}
				label="Require email verification"
				description="New users must click a link emailed to them before they can sign in. Requires SMTP."
				onToggle={() => { emailVerificationSetting = !emailVerificationSetting; saveAppSettings(); }}
			/>
			{#if emailVerificationSetting && appSettings && !appSettings.smtpConfigured}
				<div class="mt-2 bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm">
					Email verification is on, but SMTP is not configured — verification emails will not be sent, and new accounts will be stuck unable to sign in. Configure SMTP below before enabling it.
				</div>
			{/if}
		</div>

		<div class="border-t border-line-soft pt-4">
			<h4 class="font-display font-semibold text-sm mb-2">SMTP</h4>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="smtp-host" class="block text-sm font-medium text-ink-soft mb-1">Host</label>
					<input id="smtp-host" type="text" bind:value={smtpHost} placeholder="smtp.example.com" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
				</div>
				<div>
					<label for="smtp-port" class="block text-sm font-medium text-ink-soft mb-1">Port</label>
					<input id="smtp-port" type="number" bind:value={smtpPort} placeholder="587" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
				</div>
				<div>
					<label for="smtp-user" class="block text-sm font-medium text-ink-soft mb-1">Username</label>
					<input id="smtp-user" type="text" bind:value={smtpUser} placeholder="user@example.com" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
				</div>
				<div>
					<label for="smtp-pass" class="block text-sm font-medium text-ink-soft mb-1">Password</label>
					<input id="smtp-pass" type="password" bind:value={smtpPass} placeholder="••••••" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
				</div>
				<div class="col-span-2">
					<label for="smtp-from" class="block text-sm font-medium text-ink-soft mb-1">From address</label>
					<input id="smtp-from" type="email" bind:value={smtpFrom} placeholder="Nido <nido@example.com>" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
				</div>
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			<button type="button" disabled={savingSettings} on:click={saveAppSettings} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50">
				{savingSettings ? 'Saving...' : 'Save settings'}
			</button>
			<button type="button" disabled={testingSmtp} on:click={testSmtp} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:text-ink disabled:opacity-50">
				{testingSmtp ? 'Sending...' : 'Send test email'}
			</button>
		</div>
	</div>
</div>
