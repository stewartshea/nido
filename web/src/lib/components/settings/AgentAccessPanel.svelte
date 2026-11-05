<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { notify, fail } from '$lib/stores/feedback';
	import { mcpAPI, type McpToken } from '$lib/api/mcp';
	import { Bot, Copy, Check, Trash2 } from 'lucide-svelte';

	/**
	 * Agent access: tokens an AI agent uses to reach this family's data through
	 * the MCP server. The plaintext is shown once, here, and never again — the
	 * server stores only a hash.
	 */
	export let activeFamily: any = null;
	export let activeFamilyId: string | null = null;

	let tokens: McpToken[] = [];
	let loading = true;
	let creating = false;
	let revokingId: string | null = null;
	let label = '';

	// The plaintext handed back by the mint response; cleared once dismissed.
	let freshToken = '';
	let copied = '';
	let error = '';

	$: canManage = activeFamily?.role === 'owner' || activeFamily?.role === 'admin';
	// The MCP endpoint is same-origin as the app; the API is proxied, but /mcp
	// is served by the same host the browser is on.
	$: mcpUrl = browser ? `${window.location.origin}/mcp` : '/mcp';
	$: configSnippet = freshToken
		? JSON.stringify(
				{
					mcpServers: {
						nido: {
							type: 'http',
							url: mcpUrl,
							headers: { Authorization: `Bearer ${freshToken}` },
						},
					},
				},
				null,
				2,
			)
		: '';

	async function loadTokens() {
		if (!activeFamilyId) {
			tokens = [];
			loading = false;
			return;
		}
		loading = true;
		try {
			const res = await mcpAPI.listTokens();
			tokens = res.data.tokens ?? [];
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to load agent tokens.';
		} finally {
			loading = false;
		}
	}

	async function createToken(event: SubmitEvent) {
		event.preventDefault();
		fail('');
		creating = true;
		freshToken = '';
		try {
			const res = await mcpAPI.createToken(label.trim() || undefined);
			freshToken = res.data.token;
			label = '';
			await loadTokens();
			notify('Agent token created. Copy it now — it will not be shown again.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to create agent token.');
		} finally {
			creating = false;
		}
	}

	async function revoke(id: string) {
		if (!confirm('Revoke this token? Any agent using it loses access immediately.')) return;
		fail('');
		revokingId = id;
		try {
			await mcpAPI.revokeToken(id);
			if (freshToken) freshToken = '';
			await loadTokens();
			notify('Token revoked.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to revoke token.');
		} finally {
			revokingId = null;
		}
	}

	async function copy(text: string, which: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = which;
			setTimeout(() => {
				if (copied === which) copied = '';
			}, 2000);
		} catch {
			fail('Could not copy to the clipboard.');
		}
	}

	function formatDate(value: string | null): string {
		if (!value) return 'never';
		try {
			return new Date(value).toLocaleString();
		} catch {
			return value;
		}
	}

	onMount(loadTokens);
</script>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
	<div class="flex items-center gap-3 mb-2">
		<Bot class="w-5 h-5 text-ink-soft" />
		<h3 class="text-lg font-display font-semibold">Agent access</h3>
	</div>
	<p class="text-sm text-ink-soft mb-4">
		Connect an AI agent to this family through Nido's MCP server. An agent can read your family's data
		and log against it, using the same validated routes the app uses. Nido runs no model itself — the
		agent is a client you run.
	</p>

	{#if error}
		<p class="text-sm text-danger-text mb-3">{error}</p>
	{/if}

	<!-- The one-time plaintext and a ready-to-paste config -->
	{#if freshToken}
		<div class="bg-surface2 border border-line-soft rounded-md p-3 mb-4">
			<p class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-1">Your new token</p>
			<p class="text-xs text-danger-text mb-2">Copy it now. For your security it is not shown again.</p>
			<div class="flex gap-2 mb-3">
				<input
					readonly
					value={freshToken}
					on:focus={(e) => e.currentTarget.select()}
					class="flex-1 min-w-0 px-3 py-2 border border-line rounded-md font-mono text-xs"
					aria-label="Agent token"
				/>
				<button
					type="button"
					on:click={() => copy(freshToken, 'token')}
					class="h-9 px-3 rounded-md bg-primary text-on-primary text-sm font-semibold flex items-center gap-1"
				>
					{#if copied === 'token'}<Check class="w-4 h-4" /> Copied{:else}<Copy class="w-4 h-4" /> Copy{/if}
				</button>
			</div>
			<p class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-1">MCP config</p>
			<pre class="bg-page border border-line-soft rounded-md p-3 overflow-x-auto text-xs font-mono text-ink">{configSnippet}</pre>
			<button
				type="button"
				on:click={() => copy(configSnippet, 'config')}
				class="mt-2 h-9 px-3 rounded-md bg-surface border border-line text-ink text-sm font-semibold flex items-center gap-1"
			>
				{#if copied === 'config'}<Check class="w-4 h-4" /> Copied{:else}<Copy class="w-4 h-4" /> Copy config{/if}
			</button>
		</div>
	{/if}

	<!-- Generate -->
	{#if canManage}
		<form on:submit={createToken} class="flex flex-col sm:flex-row gap-2 mb-5">
			<input
				type="text"
				bind:value={label}
				maxlength="60"
				placeholder="Label (optional) — e.g. my laptop agent"
				class="flex-1 px-3 py-2 h-11 border border-line rounded-md"
			/>
			<button
				type="submit"
				disabled={creating}
				class="h-11 px-4 rounded-md bg-primary text-on-primary font-semibold disabled:opacity-50"
			>
				{creating ? 'Generating...' : 'Generate token'}
			</button>
		</form>
	{:else}
		<p class="text-xs text-ink-soft mb-5">Only an owner or admin can create or revoke tokens.</p>
	{/if}

	<!-- Existing tokens -->
	<h4 class="font-display font-semibold mb-2">Tokens</h4>
	{#if loading}
		<p class="text-sm text-ink-soft">Loading…</p>
	{:else if tokens.length === 0}
		<p class="text-sm text-ink-soft">No agent tokens yet.</p>
	{:else}
		<ul class="divide-y divide-line-soft">
			{#each tokens as token (token.id)}
				<li class="py-2 flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="text-sm font-semibold text-ink truncate">{token.label || 'Unlabelled token'}</p>
						<p class="text-xs text-ink-soft mt-0.5">
							Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
						</p>
					</div>
					{#if canManage}
						<button
							type="button"
							on:click={() => revoke(token.id)}
							disabled={revokingId === token.id}
							class="text-xs text-danger-text underline flex items-center gap-1 disabled:opacity-50 shrink-0"
						>
							<Trash2 class="w-3.5 h-3.5" /> {revokingId === token.id ? 'revoking…' : 'revoke'}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
