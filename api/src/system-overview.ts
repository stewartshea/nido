// system-overview.ts
//
// Instance-wide roll-up stats and component health for the platform admin's
// Admin tab: how many families and accounts exist, how big the databases and
// attachment store are, and the health + free space of each component.
//
// Read-only and deliberately cheap. It reads the *registry* (family/account
// routing) and filesystem metadata (directory sizes, statfs), but never opens a
// family database. Per AGENTS.md the notification sweep is the only code that
// may enumerate families, and even that opens one database at a time — so this
// stays at the registry + filesystem level rather than aggregating record
// counts across tenants (which no query could do across separate encrypted
// files anyway).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDataDir } from './db-core';
import { getRegistryClient } from './db-namespaces';
import { blobRootDir } from './blob-store';
import { getAppSettings, smtpConfigured } from './mail';
import { schedulerStatus } from './scheduler';

export type ComponentStatus = 'ok' | 'warn' | 'down';

export interface OverviewMetric {
	label: string;
	value: string;
}

export interface OverviewComponent {
	key: string;
	name: string;
	status: ComponentStatus;
	summary: string;
	/** Capacity used, 0–100, for components that have a volume; else null. */
	usagePct: number | null;
	metrics: OverviewMetric[];
}

export interface SystemOverview {
	generatedAt: string;
	instance: {
		node: string;
		platform: string;
		pid: number;
		uptimeSeconds: number;
		hostname: string;
		dataDir: string;
		blobDir: string;
		memoryRssBytes: number;
		memoryHeapUsedBytes: number;
		loadAverage: number | null;
	};
	rollup: {
		families: number;
		activeFamilies: number;
		orphanedFamilies: number;
		accounts: number;
		platformAdmins: number;
		familyDbFiles: number;
		familyDbBytes: number;
		familyDbWalBytes: number;
		registryBytes: number;
		attachmentFiles: number;
		attachmentBytes: number;
		diskFreeBytes: number | null;
		diskTotalBytes: number | null;
	};
	components: OverviewComponent[];
}

// ---------------------------------------------------------------------------
// Formatting helpers (kept here so the API is the one place that decides how a
// byte count or a duration reads; the UI just renders the strings).
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
	let value = bytes / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
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

// ---------------------------------------------------------------------------
// Filesystem probes
// ---------------------------------------------------------------------------

interface DirStats {
	files: number;
	bytes: number;
	truncated: boolean;
}

/**
 * Recursively total a directory. Attachment blobs fan out by year/month, so the
 * depth is small, but the entry budget still caps the walk so a pathological
 * tree cannot hang an admin request.
 */
export function dirStats(root: string, maxEntries = 200_000): DirStats {
	const out: DirStats = { files: 0, bytes: 0, truncated: false };
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			try {
				out.bytes += fs.statSync(full).size;
			} catch {
				continue;
			}
			out.files += 1;
			if (out.files >= maxEntries) {
				out.truncated = true;
				return out;
			}
		}
	}
	return out;
}

interface FamilyDbStats {
	count: number;
	bytes: number;
	walBytes: number;
}

/** Totals the per-family database files by directory listing, never opening one. */
export function familyDbStats(dataDir = getDataDir()): FamilyDbStats {
	const out: FamilyDbStats = { count: 0, bytes: 0, walBytes: 0 };
	const dir = path.join(dataDir, 'db');
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		if (!name.endsWith('.db')) continue;
		const full = path.join(dir, name);
		try {
			out.bytes += fs.statSync(full).size;
		} catch {
			continue;
		}
		out.count += 1;
		try {
			out.walBytes += fs.statSync(`${full}-wal`).size;
		} catch {
			// No WAL file, or it was checkpointed away — nothing to add.
		}
	}
	return out;
}

interface DiskStats {
	path: string;
	totalBytes: number;
	freeBytes: number;
	availableBytes: number;
	usedPct: number;
}

/** Walk up to the nearest existing ancestor so a not-yet-created dir still resolves. */
function nearestExisting(target: string): string {
	let cur = path.resolve(target);
	// Bounded by path depth; dirname('') is the only fixed point an absolute
	// path can reach, and we stop there.
	while (!fs.existsSync(cur)) {
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	return cur;
}

export function diskStats(target: string): DiskStats | null {
	try {
		const resolved = nearestExisting(target);
		const s = fs.statfsSync(resolved);
		const totalBytes = Number(s.blocks) * Number(s.bsize);
		const freeBytes = Number(s.bfree) * Number(s.bsize);
		const availableBytes = Number(s.bavail) * Number(s.bsize);
		const usedPct = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0;
		return { path: resolved, totalBytes, freeBytes, availableBytes, usedPct };
	} catch {
		// statfs is unavailable on this platform/build — report "unknown" rather
		// than failing the whole overview.
		return null;
	}
}

/**
 * Free space matters before it is full: at under 15% (or 2 GB) reclaim it, at
 * under 5% (or 512 MB) the next write is likely to fail.
 */
export function diskStatus(disk: DiskStats | null): ComponentStatus {
	if (!disk || disk.totalBytes <= 0) return 'warn';
	const freePct = disk.availableBytes / disk.totalBytes;
	if (freePct < 0.05 || disk.availableBytes < 512 * 1024 * 1024) return 'down';
	if (freePct < 0.15 || disk.availableBytes < 2 * 1024 * 1024 * 1024) return 'warn';
	return 'ok';
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface RegistryCounts {
	reachable: boolean;
	schema: number;
	families: number;
	activeFamilies: number;
	orphanedFamilies: number;
	accounts: number;
	platformAdmins: number;
}

async function readRegistryCounts(): Promise<RegistryCounts> {
	const counts: RegistryCounts = {
		reachable: false,
		schema: 0,
		families: 0,
		activeFamilies: 0,
		orphanedFamilies: 0,
		accounts: 0,
		platformAdmins: 0,
	};
	try {
		const registry = await getRegistryClient();
		const families = await registry.execute({
			sql: `SELECT COUNT(*) AS total,
			             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
			             SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS orphaned
			      FROM families`,
			args: [],
		});
		const accountRows = await registry.execute({ sql: 'SELECT COUNT(*) AS c FROM user_routing', args: [] });
		const adminRows = await registry.execute({
			sql: 'SELECT COUNT(*) AS c FROM user_routing WHERE is_platform_admin = 1',
			args: [],
		});
		const schemaRows = await registry.execute({ sql: 'PRAGMA user_version', args: [] });
		counts.reachable = true;
		counts.families = Number(families.rows[0]?.total ?? 0);
		counts.activeFamilies = Number(families.rows[0]?.active ?? 0);
		counts.orphanedFamilies = Number(families.rows[0]?.orphaned ?? 0);
		counts.accounts = Number(accountRows.rows[0]?.c ?? 0);
		counts.platformAdmins = Number(adminRows.rows[0]?.c ?? 0);
		counts.schema = Number(schemaRows.rows[0]?.user_version ?? 0);
	} catch {
		// Registry unreachable is itself the health signal; fall through with the
		// zeroed counts and let the component report 'down'.
	}
	return counts;
}

export async function buildSystemOverview(): Promise<SystemOverview> {
	const dataDir = getDataDir();
	const blobDir = blobRootDir();

	const [counts, settings] = await Promise.all([readRegistryCounts(), getAppSettings()]);

	let registryBytes = 0;
	try {
		registryBytes = fs.statSync(path.join(dataDir, 'registry.db')).size;
	} catch {
		// Not created yet, or unreadable; the registry component reports that.
	}

	const familyDbs = familyDbStats(dataDir);
	const attachments = dirStats(blobDir);
	const dataDisk = diskStats(dataDir);
	const blobDisk = blobDiskComponent(blobDir, dataDisk);
	const mem = process.memoryUsage();
	const scheduler = schedulerStatus();
	const mailConfigured = smtpConfigured(settings);

	const components: OverviewComponent[] = [];

	// 1. API process ------------------------------------------------------
	components.push({
		key: 'api',
		name: 'API process',
		status: 'ok',
		summary: `Node ${process.version} · up ${formatDuration(process.uptime())}`,
		usagePct: null,
		metrics: [
			{ label: 'Uptime', value: formatDuration(process.uptime()) },
			{ label: 'Memory (RSS)', value: formatBytes(mem.rss) },
			{ label: 'Heap used', value: formatBytes(mem.heapUsed) },
			{ label: 'PID', value: String(process.pid) },
		],
	});

	// 2. Registry database ------------------------------------------------
	components.push({
		key: 'registry',
		name: 'Registry database',
		status: counts.reachable ? 'ok' : 'down',
		summary: counts.reachable
			? `Schema v${counts.schema} · ${counts.activeFamilies} active ${counts.activeFamilies === 1 ? 'family' : 'families'}`
			: 'Unreachable',
		usagePct: null,
		metrics: [
			{ label: 'Size', value: formatBytes(registryBytes) },
			{ label: 'Schema', value: counts.reachable ? `v${counts.schema}` : '—' },
			{ label: 'Families', value: String(counts.activeFamilies) },
			{ label: 'No accounts', value: String(counts.orphanedFamilies) },
			{ label: 'Accounts', value: String(counts.accounts) },
			{ label: 'Admins', value: String(counts.platformAdmins) },
		],
	});

	// 3. Family databases -------------------------------------------------
	const walHeavy = familyDbs.bytes > 0 && familyDbs.walBytes > familyDbs.bytes;
	components.push({
		key: 'families',
		name: 'Family databases',
		status: walHeavy ? 'warn' : 'ok',
		summary:
			familyDbs.count === 0
				? 'No family databases yet'
				: `${familyDbs.count} ${familyDbs.count === 1 ? 'database' : 'databases'} · ${formatBytes(familyDbs.bytes)}`,
		usagePct: null,
		metrics: [
			{ label: 'Databases', value: String(familyDbs.count) },
			{ label: 'On disk', value: formatBytes(familyDbs.bytes) },
			{
				label: 'Write-ahead log',
				value: familyDbs.walBytes > 0 ? formatBytes(familyDbs.walBytes) : 'checkpointed',
			},
		],
	});

	// 4. Attachment store -------------------------------------------------
	let blobRootExists = false;
	try {
		blobRootExists = fs.existsSync(blobDir);
	} catch {
		blobRootExists = false;
	}
	components.push({
		key: 'attachments',
		name: 'Attachment store',
		status: attachments.truncated ? 'warn' : 'ok',
		summary: attachments.truncated
			? `Showing first ${attachments.files.toLocaleString()} files`
			: `${attachments.files.toLocaleString()} ${attachments.files === 1 ? 'file' : 'files'} · ${formatBytes(attachments.bytes)}`,
		usagePct: null,
		metrics: [
			{ label: 'Files', value: attachments.files.toLocaleString() },
			{ label: 'On disk', value: formatBytes(attachments.bytes) },
			{ label: 'Location', value: blobRootExists ? 'present' : 'not created yet' },
		],
	});

	// 5. Data volume (databases live here) --------------------------------
	components.push(diskComponent('disk-data', 'Data volume', dataDisk));

	// 6. Blob volume (only when it is not the same mount as the data volume) -
	if (blobDisk) components.push(blobDisk);

	// 7. Mail -------------------------------------------------------------
	components.push({
		key: 'mail',
		name: 'Mail (SMTP)',
		status: mailConfigured ? 'ok' : 'warn',
		summary: mailConfigured
			? `${settings.smtp_host}:${settings.smtp_port}`
			: 'Not configured — verification and digests cannot send',
		usagePct: null,
		metrics: [
			{ label: 'Host', value: settings.smtp_host || '—' },
			{ label: 'Port', value: settings.smtp_port ? String(settings.smtp_port) : '—' },
			{ label: 'From', value: settings.smtp_from || 'default' },
		],
	});

	// 8. Notification scheduler ------------------------------------------
	components.push({
		key: 'scheduler',
		name: 'Notification scheduler',
		status: !scheduler.enabled ? 'warn' : scheduler.running ? 'ok' : 'warn',
		summary: scheduler.enabled
			? scheduler.running
				? `Running every ${scheduler.intervalMinutes} min`
				: 'Enabled but not running'
			: 'Disabled',
		usagePct: null,
		metrics: [
			{ label: 'Enabled', value: scheduler.enabled ? 'yes' : 'no' },
			{ label: 'Running', value: scheduler.running ? 'yes' : 'no' },
			{ label: 'Interval', value: `${scheduler.intervalMinutes} min` },
		],
	});

	return {
		generatedAt: new Date().toISOString(),
		instance: {
			node: process.version,
			platform: `${os.type()} ${os.release()}`,
			pid: process.pid,
			uptimeSeconds: Math.round(process.uptime()),
			hostname: os.hostname(),
			dataDir,
			blobDir,
			memoryRssBytes: mem.rss,
			memoryHeapUsedBytes: mem.heapUsed,
			loadAverage: os.loadavg()[0] ?? null,
		},
		rollup: {
			families: counts.families,
			activeFamilies: counts.activeFamilies,
			orphanedFamilies: counts.orphanedFamilies,
			accounts: counts.accounts,
			platformAdmins: counts.platformAdmins,
			familyDbFiles: familyDbs.count,
			familyDbBytes: familyDbs.bytes,
			familyDbWalBytes: familyDbs.walBytes,
			registryBytes,
			attachmentFiles: attachments.files,
			attachmentBytes: attachments.bytes,
			diskFreeBytes: dataDisk?.availableBytes ?? null,
			diskTotalBytes: dataDisk?.totalBytes ?? null,
		},
		components,
	};
}

function diskComponent(key: string, name: string, disk: DiskStats | null): OverviewComponent {
	if (!disk) {
		return {
			key,
			name,
			status: 'warn',
			summary: 'Capacity unavailable on this platform',
			usagePct: null,
			metrics: [{ label: 'Free space', value: 'unknown' }],
		};
	}
	return {
		key,
		name,
		status: diskStatus(disk),
		summary: `${formatBytes(disk.availableBytes)} free of ${formatBytes(disk.totalBytes)}`,
		usagePct: Number(disk.usedPct.toFixed(1)),
		metrics: [
			{ label: 'Free', value: formatBytes(disk.availableBytes) },
			{ label: 'Used', value: `${disk.usedPct.toFixed(1)}%` },
			{ label: 'Total', value: formatBytes(disk.totalBytes) },
			{ label: 'Mount', value: disk.path },
		],
	};
}

/**
 * A second disk component, but only when the blob directory resolves to a
 * different mount than the data directory — otherwise it is the same numbers
 * twice and the panel says less, not more.
 */
function blobDiskComponent(blobDir: string, dataDisk: DiskStats | null): OverviewComponent | null {
	const blobDisk = diskStats(blobDir);
	if (!blobDisk) return null;
	if (dataDisk && dataDisk.path === blobDisk.path) return null;
	return diskComponent('disk-blobs', 'Blob volume', blobDisk);
}
