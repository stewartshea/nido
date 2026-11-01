// feedings.ts — one sheet, not five handlers. The factory
// (category-routes.ts) holds the behavior; this declares the category.
import { z } from 'zod';
import { type CategorySheet, categoryRoutes } from './category-routes';

const selectColumns = [
	'id', 'subject_id', 'start_time', 'end_time', 'duration', 'amount', 'amount_unit', 'type', 'side',
	'left_breast_at', 'right_breast_at', 'left_duration', 'right_duration', 'formula_id', 'formula_item_id', 'notes',
	'created_at', 'created_by',
];

// ML_PER_OZ — the US fluid ounce, the one amountUnit 'oz' means here.
export const ML_PER_OZ = 29.5735295625;

/** Any logged quantity, normalized to ounces — the unit formula stock is kept in. */
export function amountOz(data: Record<string, unknown>): number | null {
	const amount = Number(data.amount);
	if (!Number.isFinite(amount) || amount <= 0) return null;
	const oz = data.amountUnit === 'ml' ? amount / ML_PER_OZ : amount;
	return Math.round(oz * 100) / 100;
}

// Zod schemas for validation
const createFeedingSchema = z.object({
	memberId: z.number(),
	startTime: z.string().datetime(),
	endTime: z.string().datetime().optional(),
	amount: z.number().positive().optional(),
	amountUnit: z.enum(['ml', 'oz']).optional(),
	type: z.enum(['breast', 'bottle', 'pump', 'formula', 'solid']),
	side: z.enum(['left', 'right', 'both']).optional(),
	leftBreastAt: z.string().datetime().optional(),
	rightBreastAt: z.string().datetime().optional(),
	leftDuration: z.number().int().nonnegative().optional(),
	rightDuration: z.number().int().nonnegative().optional(),
	formulaId: z.number().optional(),
	// The inventory container the bottle drew from. `formula_id` keeps
	// accepting legacy payloads (an offline queue replaying a pre-inventory
	// record); new readers use this.
	formulaItemId: z.number().int().positive().optional(),
	notes: z.string().optional(),
});

const updateFeedingSchema = z.object({
	startTime: z.string().datetime().optional(),
	endTime: z.string().datetime().optional(),
	amount: z.number().positive().optional(),
	amountUnit: z.enum(['ml', 'oz']).optional(),
	type: z.enum(['breast', 'bottle', 'pump', 'formula', 'solid']).optional(),
	side: z.enum(['left', 'right', 'both']).nullable().optional(),
	leftBreastAt: z.string().datetime().nullable().optional(),
	rightBreastAt: z.string().datetime().nullable().optional(),
	leftDuration: z.number().int().nonnegative().nullable().optional(),
	rightDuration: z.number().int().nonnegative().nullable().optional(),
	formulaId: z.number().optional(),
	formulaItemId: z.number().int().positive().nullable().optional(),
	notes: z.string().optional(),
});

// duration = max(0, end - start) in ms, computed on read when the stored
// value is missing (the rows written before duration was tracked) or stale.
const deriveFeedingRow = (row: Record<string, unknown>) => {
	if (!row.duration && row.start_time && row.end_time) {
		const start = new Date(row.start_time as string).getTime();
		const end = new Date(row.end_time as string).getTime();
		row.duration = Math.max(0, end - start);
	}
};

const feedingSheet: CategorySheet = {
	table: 'feedings',
	orderExpr: 'start_time',
	selectColumns,
	handlers: ['list', 'get', 'create', 'update', 'delete'],
	createSchema: createFeedingSchema,
	updateSchema: updateFeedingSchema,
	columns: {
		startTime: 'start_time',
		endTime: 'end_time',
		amount: 'amount',
		amountUnit: 'amount_unit',
		type: 'type',
		side: 'side',
		leftBreastAt: 'left_breast_at',
		rightBreastAt: 'right_breast_at',
		leftDuration: 'left_duration',
		rightDuration: 'right_duration',
		formulaId: 'formula_id',
		formulaItemId: 'formula_item_id',
		notes: 'notes',
	},
	insert: {
		columns: [...selectColumns.slice(1)],
		values: (d, subjectId, now, userId) => {
			// duration in ms, stored whenever both ends of the range are known
			let duration: number | null = null;
			if (d.startTime && d.endTime) {
				const start = new Date(d.startTime as string).getTime();
				const end = new Date(d.endTime as string).getTime();
				duration = Math.max(0, end - start);
			}
			return [
				subjectId,
				d.startTime,
				d.endTime || null,
				duration,
				d.amount || null,
				d.amountUnit || 'oz',
				d.type,
				d.side || null,
				d.leftBreastAt || null,
				d.rightBreastAt || null,
				d.leftDuration ?? null,
				d.rightDuration ?? null,
				d.formulaId || null,
				d.formulaItemId ?? null,
				d.notes || null,
				now,
				userId,
			];
		},
	},
	responseMode: 'raw',
	deriveRow: deriveFeedingRow,
	recomputeDuration: { startKey: 'startTime', endKey: 'endTime', startCol: 'start_time', durationCol: 'duration' },
	listKey: 'feedings',
	itemKey: 'feeding',
	nouns: { singular: 'feeding', article: 'a' },
	messages: {
		memberRequired: 'Member ID is required',
		memberDenied: 'Member not found or access denied',
		notFound: 'Feeding not found or access denied',
		accessDenied: 'Access denied',
		listFailed: 'Failed to fetch feedings',
		getFailed: 'Failed to fetch feeding',
		createFailed: 'Failed to create feeding',
		updateFailed: 'Failed to update feeding',
		deleteFailed: 'Failed to delete feeding',
		created: 'Feeding created successfully',
		updated: 'Feeding updated successfully',
		deleted: 'Feeding deleted successfully',
		createdStatus: 200,
	},
	// A bottle fed is a bottle to wash, so a linked item bills stock from this
	// log, with the feed's type among the event's attributes so a rule can
	// narrow to bottle feeds only. Two more travel the same way:
	// `amountOz` (the logged amount normalized to ounces) is what a
	// direct-amount rule subtracts from a formula container, and `billedItem`
	// is which container — the pin that keeps one family's two cans from
	// each billing every feed.
	emit: {
		category: 'feeds',
		billedItem: (d) => (d.formulaItemId == null ? null : Number(d.formulaItemId)),
		attrs: (d) => ({
			type: d.type as string,
			amountOz: amountOz(d) == null ? null : String(amountOz(d)),
		}),
	},
};

export const feedingRoutes = categoryRoutes(feedingSheet);