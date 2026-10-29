// src/lib/api/types.ts — every interface and type the API modules and their
// importers share. Shapes mirror the API's JSON responses; keep them here
// uniformly rather than beside each domain module.

export interface FamilyAccount {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

/** The metadata for one stored file, as every attachment endpoint returns it. */
export type AttachmentMeta = {
  id: number;
  refType: string;
  refId: number;
  filename: string | null;
  contentType: string;
  size: number;
  url: string;
};

/** A vital sign reading — blood pressure carries two numbers, the rest one. */
export interface Vital {
  id: number;
  memberId: number;
  kind: string;
  systolic: number | null;
  diastolic: number | null;
  value: number | null;
  unit: string | null;
  recordedAt: string;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}

/** A standing medication with its schedule state. */
export interface Medication {
  id: number;
  subjectId: number;
  memberName: string;
  name: string;
  dose: string | null;
  frequency: string;
  frequencyLabel: string;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  active: boolean;
  lastDoseAt: string | null;
  nextDueAt: string | null;
  due: boolean;
}

export interface MedicationFrequency {
  id: string;
  label: string;
  hours: number | null;
}

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
  /** Capacity used, 0–100, for components with a volume; else null. */
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

export interface RegistryFamilyRow {
  familyId: string;
  name: string;
  familyCode: string | null;
  status: string;
  /** Accounts whose routing points here; 0 means the family is retained but unreachable. */
  accountCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RegistryUserRow {
  email: string;
  familyId: string;
  userId: string;
  role: string;
  isPlatformAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegistryLeaseRow {
  name: string;
  holder: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface RegistrySettingsView {
  signupEnabled: boolean;
  signupEnvLocked: boolean;
  emailVerification: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpFrom: string | null;
  smtpUserSet: boolean;
  smtpPassSet: boolean;
  smtpConfigured: boolean;
  updatedAt: string;
}

export interface RegistryView {
  families: RegistryFamilyRow[];
  users: RegistryUserRow[];
  leases: RegistryLeaseRow[];
  settings: RegistrySettingsView;
}

/** The controlled vocabulary of home asset categories (API is the source of truth). */
export type AssetCategoryId = 'vehicle' | 'appliance' | 'hvac' | 'structure' | 'outdoor' | 'other';

/** A durable thing the family owns that needs care. Not inventory stock. */
export interface Asset {
	id: number;
	name: string;
	category: AssetCategoryId;
	/** The residence this asset lives at (a homes row), or null = family-wide. */
	homeId: number | null;
	/** The identity quartet: keys manuals and the "add a car" populate moment. */
	identity: {
		manufacturer: string | null;
		model: string | null;
		modelYear: number | null;
		serial: string | null;
	};
	acquiredAt: string | null;
	/** Cents. Kept integer so a cost rollup never invents precision. */
	purchasePrice: number | null;
	notes: string | null;
	archivedAt: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface InventoryItem {
	id: number;
	memberId: number | null;
	name: string;
	category: string;
	variant: string | null;
	quantity: number;
	unit: string;
	packSize: number | null;
	leadDays: number | null;
	/**
	 * The rule's activity, mirrored from consumptionRule for older readers.
	 * Null when the item is not consumed by logged events.
	 */
	eventCategory: string | null;
	/** The single option the rule narrowed to, when one attribute is filtered to one value. */
	eventOption: string | null;
	/** Units of the activity that make one whole use (N in "1 per N"). */
	unitsPerDecrement: number | null;
	/** Progress toward the next whole use, accrued between logs. */
	consumeCarry: number;
	decrementPerEvent: number | null;
	/** The real rule — activity, conditions, ratio — or null when unlinked. */
	consumptionRule: ConsumptionRule | null;
	active: boolean;
	notes: string | null;
	consumptionPerDay: number;
	daysOfCover: number | null;
	runoutAt: string | null;
	lowConfidence: boolean;
	/** True when a rule is firing for this item right now. */
	alerting: boolean;
	/** What the adjustment ledger says the count should be, or null with no history. */
	ledgerQuantity: number | null;
	/** ledgerQuantity minus quantity; non-zero means the two disagree. */
	drift: number | null;
	/** Days between automatic uses, for things consumed by the calendar. */
	consumeIntervalDays: number | null;
	consumeStartedAt: string | null;
	/** Optional expiry date; drives the days_to_expiry signal. */
	expiresAt: string | null;
	/** Whole days until expiry, or null when unset or already past. */
	daysToExpiry: number | null;
	/** When the next automatic use falls due, once catch-up is settled. */
	nextConsumptionAt: string | null;
}

export interface InventoryAlert {
	ruleId: number;
	itemId: number;
	itemName: string;
	signal: string;
	signalLabel: string;
	comparator: 'lt' | 'lte' | 'gt' | 'gte';
	threshold: number;
	value: number;
	unit: string;
	/** False once the family has already been told about this crossing. */
	notified: boolean;
	message: string;
}

export interface Audience {
	kind: 'family' | 'users';
	ids: string[];
}

export interface InventoryRule {
	id: number;
	itemId: number | null;
	category: string | null;
	signal: string;
	comparator: 'lt' | 'lte' | 'gt' | 'gte';
	threshold: number;
	repeatDays: number | null;
	enabled: boolean;
	createdBy: string | null;
	createdByName: string | null;
	audienceKind: 'family' | 'users';
	audienceIds: string[];
}

export interface ReminderCondition {
	category: string;
	values?: string[];
}

/** One dimension of an activity a rule can filter on (a feed's type, a milestone's kind). */
export interface ActivityAttribute {
	/** What the condition names, e.g. 'type' or 'kind'. */
	key: string;
	/** The column the route stores it in; where emitActivity reads the event's value. */
	column: string;
	kind: 'enum' | 'number' | 'text';
	/** Known values for enum attributes, the registry's vocabulary merged with the family's own. */
	values: string[];
}

/** A logged category an inventory item can be consumed by (GET /inventory/activities). */
export interface ConsumableActivity {
	/** The category — what a rule's sourceCategory stores ('vitamins', 'feeds'). */
	id: string;
	/** The table the category's records land in ('events', 'feedings'). */
	table: string;
	label: string;
	/** Dimensions a rule may narrow to; empty for a category with no options (growth, journal). */
	attributes: ActivityAttribute[];
}

/** One requirement an event's attributes must meet: its 'type' among these values. */
export interface ConsumptionCondition {
	attr: string;
	values: string[];
}

/** The rule stored beside an item: subtract X for every N units of logged category Y. */
export interface ConsumptionRule {
	sourceCategory: string;
	/** 'all' conditions must hold; 'any' at least one. Empty conditions match every event. */
	match: 'all' | 'any';
	conditions: ConsumptionCondition[];
	/** Units of the activity that make one whole use (N in "X per N"). */
	unitsPerUse: number;
	/** How many items one whole use subtracts (X in "X per N"). */
	amountPerUse: number;
	/** Accrued progress toward the next whole use. */
	consumeCarry: number;
}

export interface ReminderCatalogCategory {
	id: string;
	label: string;
	options: string[];
}

export type ReminderMatch = 'any' | 'all';

export interface Reminder {
	id: number;
	kind: 'inactivity' | 'interval';
	category: string | null;
	conditions: ReminderCondition[];
	match: ReminderMatch;
	targetType: 'member' | 'home';
	targetId: number | null;
	label: string | null;
	hours: number | null;
	intervalDays: number | null;
	lastAt: string | null;
	enabled: boolean;
	overdue: boolean;
	since: string | null;
	createdBy: string | null;
	createdByName: string | null;
}

export interface DiaperBand {
	size: string;
	/** Weight at which the child moves into this size. */
	weightBandMinKg: number | null;
	/** Weight at which they grow out of it. Null when the size is open-ended. */
	weightBandMaxKg: number | null;
}

export interface NotifySchedule {
	enabled: boolean;
	running: boolean;
	intervalMinutes: number;
}

export interface NotifySummary {
	total: number;
	activity: number;
	inventory: number;
	/** Doses due by their schedule, counted family-wide. */
	medications?: number;
}

export interface Plan {
	id: number;
	subject_id: number;
	category: string;
	scheduled_at: string;
	title: string | null;
	notes: string | null;
	data: Record<string, unknown>;
	status: 'planned' | 'fulfilled' | 'missed' | 'cancelled';
	fulfilled_by: number | null;
	overdue: boolean;
	created_at: string;
}
