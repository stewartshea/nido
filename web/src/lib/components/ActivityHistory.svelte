<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		feedingAPI, diaperAPI, sleepAPI, growthAPI, milestoneAPI,
		vaccinationAPI, moodAPI, journalAPI,
	} from '$lib/api';
	import { CATEGORIES, milestoneCategory } from '$lib/shared';
	import RecordEditModal from '$lib/components/RecordEditModal.svelte';
	import {
		Milk, Baby, Moon, TrendingUp, Star, Trophy, Stethoscope, Syringe,
		Smile, Book, Calendar, PenLine, Trash2,
	} from 'lucide-svelte';

	// All tracking lists for the selected member (snake_case rows as returned
	// by the API, except moods which are camelCase).
	export let feedings: any[] = [];
	export let diapers: any[] = [];
	export let sleeps: any[] = [];
	export let growths: any[] = [];
	export let milestones: any[] = [];
	export let vaccinations: any[] = [];
	export let moods: any[] = [];
	export let journalEntries: any[] = [];
	// Categories enabled for the member — controls the filter pills.
	export let activeCategories: string[] = [];
	// Server-side row counts per list, so the component can tell "there is more
	// on the server" from "you have not scrolled far enough".
	export let totals: Record<string, number> = {};
	export let loadingMore = false;

	const dispatch = createEventDispatcher();

	const WINDOW_STEP = 200;
	let visibleCount = WINDOW_STEP;

	// A category pill can be backed by a whole list rather than a slice of one:
	// Feeds and Pumping both come from `feedings`, and Firsts/Routines/Medical/
	// Milestones all come from `milestones`. "Is there more to load?" therefore
	// has to be asked of the backing list, not of the category's filtered rows —
	// otherwise the button offers to load records the page will never render.
	const FILTER_SOURCE: Record<string, string> = {
		feeds: 'feedings', pumping: 'feedings',
		diapers: 'diapers', sleep: 'sleeps', growth: 'growths',
		milestones: 'milestones', firsts: 'milestones',
		routines: 'milestones', medical: 'milestones',
		vaccines: 'vaccinations', moods: 'moods', journal: 'journalEntries',
	};

	const KIND_ICON: Record<string, any> = {
		feeds: Milk, pumping: Milk, diapers: Baby, sleep: Moon, growth: TrendingUp,
		milestones: Trophy, firsts: Star, routines: Calendar, medical: Stethoscope,
		vaccines: Syringe, moods: Smile, journal: Book,
	};

	let filter = 'all';
	let viewMode: 'feed' | 'table' = 'feed';
	let editingKind = '';
	let editingRecord: any = null;
	let editOpen = false;

	function rowTime(r: any): string {
		return r.start_time || r.change_time || r.measurement_date || r.achieved_date
			|| r.date_given || r.recorded_at || r.recordedAt || r.entry_date || r.entryDate
			|| r.created_at || r.createdAt || '';
	}

	function recordedBy(r: any): string {
		return r.created_by_name || r.createdByName || '';
	}

	function tag(kind: string, cat: string, r: any) {
		return { ...r, _kind: kind, _cat: cat, _when: rowTime(r) };
	}

	$: merged = [
		...feedings.map((r) => tag(r.type === 'pump' ? 'pumping' : 'feeding', r.type === 'pump' ? 'pumping' : 'feeds', r)),
		...diapers.map((r) => tag('diaper', 'diapers', r)),
		...sleeps.map((r) => tag('sleep', 'sleep', r)),
		...growths.map((r) => tag('growth', 'growth', r)),
		...milestones.map((r) => tag('milestone', milestoneCategory(r), r)),
		...vaccinations.map((r) => tag('vaccine', 'vaccines', r)),
		...moods.map((r) => tag('mood', 'moods', r)),
		...journalEntries.map((r) => tag('journal', 'journal', r)),
	].sort((a, b) => new Date(b._when || 0).getTime() - new Date(a._when || 0).getTime());

	$: filterTabs = [
		{ id: 'all', label: 'All' },
		...CATEGORIES.filter((c) => activeCategories.length === 0 || activeCategories.includes(c.id)),
	];

	$: filtered = filter === 'all' ? merged : merged.filter((r) => r._cat === filter);
	$: rows = filtered.slice(0, visibleCount);
	$: serverTotal = Object.values(totals).reduce((a, b) => a + (b ?? 0), 0);
	$: loadedTotal = feedings.length + diapers.length + sleeps.length + growths.length
		+ milestones.length + vaccinations.length + moods.length + journalEntries.length;
	$: moreLoadedButHidden = filtered.length > visibleCount;
	// For 'all' the whole feed is one pool. For a single category, only that
	// category's backing list can grow — the page appends by list offset, so
	// asking the global totals would offer a button that fetches nothing.
	$: activeSource = filter === 'all' ? null : (FILTER_SOURCE[filter] ?? null);
	$: moreOnServer = activeSource
		? listLength(activeSource) < (totals[activeSource] ?? 0)
		: loadedTotal < serverTotal;
	// A category pill can be a slice of a list (Pumping inside feedings, Firsts
	// inside milestones), and the server counts whole lists, so there is no
	// honest server-side number for the slice. Fall back to the loaded count
	// rather than quoting a total that includes rows the filter will not show.
	$: displayTotal = filter === 'all' ? (serverTotal || loadedTotal) : filtered.length;

	function listLength(key: string): number {
		switch (key) {
			case 'feedings': return feedings.length;
			case 'diapers': return diapers.length;
			case 'sleeps': return sleeps.length;
			case 'growths': return growths.length;
			case 'milestones': return milestones.length;
			case 'vaccinations': return vaccinations.length;
			case 'moods': return moods.length;
			case 'journalEntries': return journalEntries.length;
			default: return 0;
		}
	}

	let lastFilter = filter;
	$: if (filter !== lastFilter) {
		lastFilter = filter;
		visibleCount = WINDOW_STEP;
	}

	function formatTime(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '—';
		return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function formatElapsed(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		return `${h > 0 ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
	}

	function details(r: any): string {
		switch (r._kind) {
			case 'feeding':
			case 'pumping': {
				const bits = [r.type];
				if (r.side) bits.push(String(r.side));
				if (r.amount) bits.push(`${r.amount}oz`);
				if (r.duration) bits.push(formatElapsed(Number(r.duration)));
				return bits.filter(Boolean).join(' · ');
			}
			case 'diaper': {
				const bits = [r.type];
				if (r.consistency) bits.push(String(r.consistency));
				if (r.color) bits.push(String(r.color));
				return bits.filter(Boolean).join(' · ');
			}
			case 'sleep': {
				const bits = [];
				if (r.duration) bits.push(formatElapsed(Number(r.duration)));
				if (r.location) bits.push(String(r.location));
				return bits.filter(Boolean).join(' · ') || '—';
			}
			case 'growth': {
				const bits = [];
				if (r.weight) bits.push(`${r.weight}${r.unit_system === 'imperial' ? 'lb' : 'kg'}`);
				if (r.height) bits.push(`${r.height}${r.unit_system === 'imperial' ? 'in' : 'cm'}`);
				if (r.head_circumference) bits.push(`head ${r.head_circumference}`);
				return bits.filter(Boolean).join(' · ') || '—';
			}
			case 'milestone': return r.title || '—';
			case 'vaccine': return r.name || '—';
			case 'mood': return r.mood || '—';
			case 'journal': return r.title || (r.body ? String(r.body).slice(0, 60) : '—');
			default: return '—';
		}
	}

	function label(r: any): string {
		const cat = CATEGORIES.find((c) => c.id === r._cat);
		return cat?.label ?? r._kind;
	}

	function openEdit(r: any) {
		editingKind = r._kind;
		editingRecord = r;
		editOpen = true;
	}

	async function deleteRecord(r: any) {
		if (!confirm('Delete this record?')) return;
		try {
			if (r._kind === 'feeding' || r._kind === 'pumping') await feedingAPI.delete(Number(r.id));
			else if (r._kind === 'diaper') await diaperAPI.delete(Number(r.id));
			else if (r._kind === 'sleep') await sleepAPI.delete(Number(r.id));
			else if (r._kind === 'growth') await growthAPI.delete(Number(r.id));
			else if (r._kind === 'milestone') await milestoneAPI.delete(Number(r.id));
			else if (r._kind === 'vaccine') await vaccinationAPI.delete(Number(r.id));
			else if (r._kind === 'mood') await moodAPI.delete(Number(r.id));
			else if (r._kind === 'journal') await journalAPI.delete(Number(r.id));
			dispatch('refresh');
		} catch (err: any) {
			alert(err.response?.data?.error || 'Failed to delete record.');
		}
	}

	function onSaved() {
		editOpen = false;
		editingRecord = null;
		dispatch('refresh');
	}
</script>

<div>
	<div class="flex flex-wrap items-center gap-2 mb-3">
		<div class="flex overflow-x-auto no-scrollbar gap-2 flex-1 min-w-0">
			{#each filterTabs as tab}
				<button
					type="button"
					on:click={() => (filter = tab.id)}
					class="flex-shrink-0 px-3 h-9 rounded-full text-sm font-semibold border transition-colors {filter === tab.id ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft hover:text-ink'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>
		<div class="flex bg-surface2 rounded-md p-1 shrink-0">
			<button type="button" on:click={() => (viewMode = 'feed')} class="{viewMode === 'feed' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'} h-8 px-3 rounded-md text-sm font-semibold transition-colors">Feed</button>
			<button type="button" on:click={() => (viewMode = 'table')} class="{viewMode === 'table' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'} h-8 px-3 rounded-md text-sm font-semibold transition-colors">Table</button>
		</div>
	</div>

	{#if rows.length > 0}
		<div class="flex flex-col items-center gap-2 py-4 text-center">
			<p class="text-xs text-ink-soft">
				Showing {rows.length} of {displayTotal}
			</p>
			{#if moreLoadedButHidden}
				<button
					type="button"
					on:click={() => (visibleCount += WINDOW_STEP)}
					class="px-4 h-9 rounded-full text-sm font-semibold border border-line-soft text-ink hover:bg-surface2 transition-colors"
				>
					Show more
				</button>
			{/if}
			{#if moreOnServer}
				<button
					type="button"
					on:click={() => dispatch('loadmore')}
					disabled={loadingMore}
					class="px-4 h-9 rounded-full text-sm font-semibold border border-line-soft text-ink hover:bg-surface2 transition-colors disabled:opacity-50"
				>
					{loadingMore ? 'Loading…' : 'Load older records'}
				</button>
			{/if}
		</div>
	{/if}

	{#if rows.length === 0}
		<p class="py-6 text-center text-ink-soft text-sm">No activities yet — log one to get started.</p>
	{:else if viewMode === 'feed'}
		<ul class="divide-y divide-line-soft">
			{#each rows as r (r._kind + '-' + r.id)}
				<li class="py-3 flex items-center gap-3">
					<span class="w-9 h-9 rounded-full bg-surface2 text-ink flex items-center justify-center shrink-0" aria-hidden="true">
						<svelte:component this={KIND_ICON[r._cat] || Milk} class="w-4 h-4" />
					</span>
					<div class="flex-1 min-w-0">
						<p class="font-semibold text-ink text-sm truncate">
							{label(r)} · {details(r)}
						</p>
						<p class="text-xs text-ink-soft">{formatTime(r._when)}{#if recordedBy(r)} · by {recordedBy(r)}{/if}</p>
						{#if (r.notes || r.body) && r._kind !== 'journal'}
							<p class="text-xs text-ink-soft truncate">{r.notes}</p>
						{/if}
					</div>
					<div class="flex items-center gap-1 shrink-0">
						<button type="button" on:click={() => openEdit(r)} class="p-2 rounded-md text-accent hover:bg-surface2" aria-label="Edit record">
							<PenLine class="w-4 h-4" />
						</button>
						<button type="button" on:click={() => deleteRecord(r)} class="p-2 rounded-md text-danger-text hover:bg-surface2" aria-label="Delete record">
							<Trash2 class="w-4 h-4" />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-ink-soft border-b border-line-soft">
						<th class="py-2 px-2">When</th>
						<th class="py-2 px-2">Type</th>
						<th class="py-2 px-2">Details</th>
						<th class="py-2 px-2">By</th>
						<th class="py-2 px-2">Notes</th>
						<th class="py-2 px-2 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r._kind + '-' + r.id)}
						<tr class="border-b border-line-soft">
							<td class="py-2 px-2 whitespace-nowrap">{formatTime(r._when)}</td>
							<td class="py-2 px-2 whitespace-nowrap">{label(r)}</td>
							<td class="py-2 px-2">{details(r)}</td>
							<td class="py-2 px-2 whitespace-nowrap">{recordedBy(r) || '—'}</td>
							<td class="py-2 px-2 text-ink-soft">{r.notes || (r._kind === 'journal' ? r.body : '') || ''}</td>
							<td class="py-2 px-2 text-right whitespace-nowrap">
								<button type="button" on:click={() => openEdit(r)} class="text-accent hover:underline">Edit</button>
								<span class="text-ink-soft mx-1">·</span>
								<button type="button" on:click={() => deleteRecord(r)} class="text-danger-text hover:underline">Delete</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<RecordEditModal bind:open={editOpen} kind={editingKind} record={editingRecord} on:saved={onSaved} />
