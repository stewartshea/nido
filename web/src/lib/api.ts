// src/lib/api.ts
import axios from 'axios';
import type { MilestoneKind } from '$lib/shared';
import { DATA_CHANGED } from './events';

// Same-origin (relative /api/v1); Vite proxies /api to the API. PUBLIC_ prefix
// is the only one exposed to the client (vite config envPrefix).
const API_BASE_URL = typeof window !== 'undefined'
  ? (import.meta.env.PUBLIC_API_URL || '/api/v1')
  : process.env.API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

type JwtPayload = { userId?: number; exp?: number };

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.prototype.map.call(atob(b64), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Request interceptor: attach the stored JWT. The backend derives the user
// from the verified token — identity is never taken from a client header.
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) return false;
    return payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

export function tokenExpired(): boolean {
  const t = localStorage.getItem('token');
  return !!t && isTokenExpired(t);
}

// Response interceptor handles errors. A 401 only logs the user out when the
// JWT is genuinely expired; transient 401s (pod restart, proxy blip, instance
// redeploy) leave the token intact so the client retries on the next request
// instead of flip-flopping to the login page.
api.interceptors.response.use(
  (response) => {
    const method = (response.config.method || 'get').toLowerCase();
    const url = response.config.url || '';
    if (method !== 'get' && typeof window !== 'undefined' && !url.startsWith('/auth')) {
      window.dispatchEvent(new Event(DATA_CHANGED));
    }
    return response;
  },
  (error) => {
    const status = error.response?.status;
    if (status === 401 && isTokenExpired(localStorage.getItem('token') || '')) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('unauthorized'));
    }
    return Promise.reject(error);
  }
);

export default api;

// Auth API functions
export const authAPI = {
  register: (userData: { email: string; password: string; firstName: string; lastName: string; next?: string }) => 
    api.post('/auth/register', userData),
  
  login: (credentials: { email: string; password: string }) => 
    api.post('/auth/login', credentials),
  
  verify: () => api.get('/auth/verify'),
  verifyEmail: (token: string) => api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
};

// User API functions
export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (userData: Partial<{ email: string; firstName: string; lastName: string }>) => 
    api.put('/users/me', userData),
};

// Baby API functions — family MEMBERS (baby is the first supported type)
export const subjectAPI = {
  getAll: () => api.get('/profiles'),
  getById: (id: number) => api.get(`/profiles/${id}`),
  create: (memberData: { name: string; birthDate: string; gender?: string; householdId: number }) => 
    api.post('/profiles', memberData),
  update: (id: number, memberData: Partial<{ name: string; birthDate: string; gender?: string }>) => 
    api.put(`/profiles/${id}`, memberData),
  delete: (id: number) => api.delete(`/profiles/${id}`),
};

// Family API functions — family-first model
export interface FamilyAccount {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
}

export const familiesAPI = {
  list: () => api.get('/families'),
  create: (data: { name: string; member?: { type: string; name: string; birthDate?: string; gender?: string; email?: string } }) =>
    api.post('/families', data),
  members: (familyId: string) => api.get(`/families/${familyId}/members`),
  accounts: () => api.get<{ accounts: FamilyAccount[] }>('/families/accounts'),
  addMember: (familyId: string, data: { type?: string; name: string; birthDate?: string; gender?: string; email?: string; categories?: string[]; stage?: string; trackable?: boolean }) =>
    api.post(`/families/${familyId}/members`, data),
  updateMember: (familyId: string, memberId: number, data: { type?: string; name?: string; birthDate?: string | null; gender?: string | null; email?: string | null; categories?: string[]; stage?: string | null; quickLinks?: string[] | null; trackable?: boolean }) =>
    api.put(`/families/${familyId}/members/${memberId}`, data),
  removeMember: (familyId: string, memberId: number) =>
    api.delete(`/families/${familyId}/members/${memberId}`),
  invite: (familyId: string, email: string) =>
    api.post(`/families/${familyId}/invitations`, { email }),
  listInvites: (familyId: string) => api.get(`/families/${familyId}/invitations`),
  revokeInvite: (familyId: string, inviteId: number) =>
    api.delete(`/families/${familyId}/invitations/${inviteId}`),
    join: (familyId: string, token: string) => api.post('/families/join', { familyId, token }),
  getAvatar: (familyId: string, memberId: number) => {
    return api.get(`/families/${familyId}/members/${memberId}/avatar`, { responseType: 'blob' });
  },
  uploadAvatar: (familyId: string, memberId: number, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return api.post(`/families/${familyId}/members/${memberId}/avatar`, form, {
      headers: { 'Content-Type': undefined },
    });
  },
  getSettings: (familyId: string) => api.get(`/families/${familyId}/settings`),
  updateSettings: (familyId: string, data: { categories?: string[]; categoryOptions?: Record<string, Record<string, string[]>>; stageCategories?: Record<string, string[]> | null; digestFrequency?: string; shareAnonymizedDaily?: boolean }) =>
    api.put(`/families/${familyId}/settings`, data),
  getAnonymizedPreview: (familyId: string) => api.get(`/families/${familyId}/settings/anonymized-preview`),
};

export interface PageOptions {
  limit?: number;
  offset?: number;
}

function pageQuery(opts?: PageOptions): string {
  if (!opts) return '';
  const parts: string[] = [];
  if (opts.limit != null) parts.push(`limit=${opts.limit}`);
  if (opts.offset) parts.push(`offset=${opts.offset}`);
  return parts.length ? `&${parts.join('&')}` : '';
}

// Feeding API functions
export const feedingAPI = {
  getAll: (memberId: number) => api.get(`/feedings?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/feedings?memberId=${memberId}${pageQuery(opts)}`),
  getById: (id: number) => api.get(`/feedings/${id}`),
  create: (feedingData: { memberId: number; startTime: string; endTime?: string; amount?: number; amountUnit?: 'ml' | 'oz'; type: 'breast' | 'bottle' | 'formula' | 'pump' | 'solid'; side?: 'left' | 'right' | 'both'; leftBreastAt?: string; rightBreastAt?: string; leftDuration?: number; rightDuration?: number; formulaId?: number; notes?: string }) => 
    api.post('/feedings', feedingData),
  update: (id: number, feedingData: Partial<{ startTime: string; endTime?: string; amount?: number; amountUnit?: 'ml' | 'oz'; type: 'breast' | 'bottle' | 'formula' | 'pump' | 'solid'; side?: 'left' | 'right' | 'both' | null; leftBreastAt?: string | null; rightBreastAt?: string | null; leftDuration?: number | null; rightDuration?: number | null; formulaId?: number; notes?: string }>) => 
    api.put(`/feedings/${id}`, feedingData),
  delete: (id: number) => api.delete(`/feedings/${id}`),
};

// Diaper API functions
export const diaperAPI = {
  getAll: (memberId: number) => api.get(`/diapers?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/diapers?memberId=${memberId}${pageQuery(opts)}`),
  getById: (id: number) => api.get(`/diapers/${id}`),
  create: (diaperData: { memberId: number; changeTime: string; type: 'wet' | 'dirty' | 'both'; color?: string; consistency?: string; notes?: string }) => 
    api.post('/diapers', diaperData),
  update: (id: number, diaperData: Partial<{ changeTime: string; type: 'wet' | 'dirty' | 'both'; color?: string; consistency?: string; notes?: string }>) => 
    api.put(`/diapers/${id}`, diaperData),
  delete: (id: number) => api.delete(`/diapers/${id}`),
};

// Sleep API functions
export const sleepAPI = {
  getAll: (memberId: number) => api.get(`/sleep?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/sleep?memberId=${memberId}${pageQuery(opts)}`),
  getById: (id: number) => api.get(`/sleep/${id}`),
  create: (sleepData: { memberId: number; startTime: string; endTime?: string; location?: string; notes?: string }) => 
    api.post('/sleep', sleepData),
  update: (id: number, sleepData: Partial<{ startTime: string; endTime?: string; location?: string; notes?: string }>) => 
    api.put(`/sleep/${id}`, sleepData),
  delete: (id: number) => api.delete(`/sleep/${id}`),
};

// Growth API functions
/**
 * Files attached to a record. Bytes live in the family's encrypted blob store;
 * this is the link and the metadata.
 */
export const attachmentsAPI = {
  upload: (refType: string, refId: number, file: File) => {
    const form = new FormData();
    form.set('refType', refType);
    form.set('refId', String(refId));
    form.set('file', file);
    // Content-Type must be unset so the browser adds the multipart boundary;
    // the instance default of application/json makes the API reject the body.
    return api.post<{ attachment: { id: number; filename: string | null; contentType: string; size: number; url: string } }>(
      '/attachments',
      form,
      { headers: { 'Content-Type': undefined } },
    );
  },
  list: (refType: string, refId: number) =>
    api.get<{ attachments: { id: number; filename: string | null; contentType: string; size: number; url: string }[] }>(
      `/attachments?refType=${encodeURIComponent(refType)}&refId=${refId}`,
    ),
  remove: (id: number) => api.delete(`/attachments/${id}`),
  /** Same-origin URL for the decrypted bytes. */
  fileUrl: (id: number) => `/api/v1/attachments/${id}/file`,
};

export const growthAPI = {
  getAll: (memberId: number) => api.get(`/growth?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/growth?memberId=${memberId}${pageQuery(opts)}`),
  getById: (id: number) => api.get(`/growth/${id}`),
  getChartData: (id: number) => api.get(`/growth/${id}/chart-data`),
  create: (growthData: { memberId: number; measurementDate: string; weight?: number; height?: number; headCircumference?: number; bmi?: number; unitSystem?: 'imperial' | 'metric'; notes?: string }) => 
    api.post('/growth', growthData),
  update: (id: number, growthData: Partial<{ measurementDate: string; weight?: number; height?: number; headCircumference?: number; bmi?: number; unitSystem?: 'imperial' | 'metric'; notes?: string }>) => 
    api.put(`/growth/${id}`, growthData),
  delete: (id: number) => api.delete(`/growth/${id}`),
};

// Milestone API functions
export const milestoneAPI = {
  getAll: (memberId: number) => api.get(`/milestones?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/milestones?memberId=${memberId}${pageQuery(opts)}`),
  getById: (id: number) => api.get(`/milestones/${id}`),
  getCategories: () => api.get('/milestones/categories'),
  getTrends: (memberId: number, opts?: { category?: string; days?: number }) =>
    api.get(`/milestones/trends?memberId=${memberId}${opts?.category ? `&category=${opts.category}` : ''}${opts?.days ? `&days=${opts.days}` : ''}`),
  create: (milestoneData: { memberId: number; title: string; description?: string; achievedDate: string; kind?: MilestoneKind; category?: string; tags?: string[] }) => 
    api.post('/milestones', milestoneData),
  update: (id: number, milestoneData: Partial<{ title: string; description?: string; achievedDate: string; kind: MilestoneKind; category?: string }>) => 
    api.put(`/milestones/${id}`, milestoneData),
  delete: (id: number) => api.delete(`/milestones/${id}`),
};

// Vaccination API functions
export const vaccinationAPI = {
  getAll: (memberId: number) => api.get(`/vaccinations?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/vaccinations?memberId=${memberId}${pageQuery(opts)}`),
  getById: (id: number) => api.get(`/vaccinations/${id}`),
  getSchedule: () => api.get('/vaccinations/schedule'),
  create: (vaccinationData: { memberId: number; name: string; dateGiven?: string; nextDueDate?: string; administeredBy?: string; notes?: string }) => 
    api.post('/vaccinations', vaccinationData),
  update: (id: number, vaccinationData: Partial<{ name: string; dateGiven?: string; nextDueDate?: string; administeredBy?: string; notes?: string }>) => 
    api.put(`/vaccinations/${id}`, vaccinationData),
  delete: (id: number) => api.delete(`/vaccinations/${id}`),
};

export const moodAPI = {
  getAll: (memberId: number) => api.get(`/moods?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/moods?memberId=${memberId}${pageQuery(opts)}`),
  create: (data: { memberId: number; mood: string; recordedAt?: string; notes?: string }) =>
    api.post('/moods', data),
  update: (id: number, data: Partial<{ mood: string; recordedAt?: string; notes?: string }>) =>
    api.put(`/moods/${id}`, data),
  delete: (id: number) => api.delete(`/moods/${id}`),
};

export const journalAPI = {
  getAll: (memberId: number) => api.get(`/journal?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get(`/journal?memberId=${memberId}${pageQuery(opts)}`),
  create: (data: { memberId: number; title?: string; body?: string; entryDate?: string }) =>
    api.post('/journal', data),
  update: (id: number, data: Partial<{ title?: string; body?: string; entryDate?: string }>) =>
    api.put(`/journal/${id}`, data),
  delete: (id: number) => api.delete(`/journal/${id}`),
};

// Health API functions
export const healthAPI = {
  getSummary: (memberId: number) => api.get(`/health/summary/${memberId}`),
  getInsights: (memberId: number) => api.get(`/health/insights/${memberId}`),
};

// Import API functions (Narababy CSV upload + per-family summary)
export const importsAPI = {
  narababy: (file: File, subjectId?: number | null, importType?: string) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (subjectId) form.append('subjectId', String(subjectId));
    if (importType) form.append('importType', importType);
    return api.post('/imports/narababy', form, {
      headers: { 'Content-Type': undefined },
    });
  },
  runs: (subjectId?: number | null) => api.get(`/imports/runs${subjectId ? `?memberId=${subjectId}` : ''}`),
  undoRun: (runId: number) => api.post(`/imports/runs/${runId}/undo`),
  summary: () => api.get('/imports/summary'),
};

// Photos API — multi-tenant: every photo is family-scoped server-side.
// Formulas API — family-scoped formula catalog.
export const formulasAPI = {
  list: (familyId: string) => api.get(`/formulas?familyId=${familyId}`),
create: (familyId: string, data: { name: string; brand?: string; formulaType?: string }) =>
		api.post('/formulas', data),
  update: (id: number, data: { name?: string; brand?: string | null; formulaType?: string | null }) =>
    api.put(`/formulas/${id}`, data),
  remove: (id: number) => api.delete(`/formulas/${id}`),
};

// Family account / admin functions
export const familyAdminAPI = {
  export: (familyId: string) => api.get(`/families/${familyId}/export`),
  restore: (familyId: string, data: any) => api.post(`/families/${familyId}/restore`, data),
  remove: (familyId: string) => api.delete(`/families/${familyId}`),
};

// Account functions
export const accountAPI = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/users/me/password', { currentPassword, newPassword }),
  remove: (confirmFamilyName?: string) => api.delete('/users/me', { data: { confirmFamilyName } }),
};

export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (data: { signupEnabled?: boolean; emailVerification?: boolean; smtpHost?: string | null; smtpPort?: number | null; smtpUser?: string | null; smtpPass?: string | null; smtpFrom?: string | null }) =>
    api.put('/settings', data),
  test: () => api.post('/settings/test'),
};

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
	eventCategory: string | null;
	decrementPerEvent: number | null;
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

export const inventoryAPI = {
	categories: () => api.get('/inventory/categories'),
	list: () => api.get<{ items: InventoryItem[]; alerts: InventoryAlert[] }>('/inventory'),
	categoriesInUse: () => api.get<{ categories: string[] }>('/inventory/categories'),
	addCategory: (name: string) => api.post('/inventory/categories', { name }),
	removeCategory: (name: string) => api.delete(`/inventory/categories/${encodeURIComponent(name)}`),
	signals: () => api.get<{ signals: { name: string; label: string; unit: string; describe: string }[] }>('/inventory/signals'),
	rules: () => api.get<{ rules: InventoryRule[] }>('/inventory/rules'),
	createRule: (data: {
		itemId?: number | null; category?: string | null; signal: string;
		comparator?: 'lt' | 'lte' | 'gt' | 'gte'; threshold: number; repeatDays?: number | null;
		audienceKind?: 'family' | 'users'; audienceIds?: string[];
	}) => api.post('/inventory/rules', data),
	deleteRule: (id: number) => api.delete(`/inventory/rules/${id}`),
	recount: (id: number, quantity: number, note?: string | null) =>
		api.post(`/inventory/${id}/recount`, { quantity, note: note ?? null }),
	resetHistory: (id: number, quantity: number, note?: string | null) =>
		api.post(`/inventory/${id}/reset-history`, { quantity, note: note ?? null }),
	resetAll: () => api.post('/inventory/reset', { confirm: 'RESET' }),
	notify: () => api.post<{ message: string; sent: number; alerts: number }>('/inventory/notify'),
	create: (data: {
		memberId?: number | null; name: string; category: string; variant?: string | null;
		quantity?: number; unit?: string; packSize?: number | null; leadDays?: number | null;
		eventCategory?: string | null; decrementPerEvent?: number | null; consumeIntervalDays?: number | null;
		expiresAt?: string | null; notes?: string | null;
	}) => api.post('/inventory', data),
	update: (id: number, data: Partial<{
		name: string; variant?: string | null; unit: string; packSize?: number | null;
		leadDays?: number | null; eventCategory?: string | null; decrementPerEvent?: number | null;
		consumeIntervalDays?: number | null; expiresAt?: string | null; notes?: string | null; active: boolean;
	}>) => api.put(`/inventory/${id}`, data),
	adjust: (id: number, data: { change: number; reason: 'purchase' | 'used' | 'manual' | 'correction'; note?: string | null }) =>
		api.post(`/inventory/${id}/adjust`, data),
	adjustments: (id: number) => api.get(`/inventory/${id}/adjustments`),
	diaperSizes: (memberId: number) =>
		api.get<{ sizes: any[]; signals: Record<string, number | null>; linkedItemId: number | null }>(
			`/inventory/diaper-sizes?memberId=${memberId}`),
	diaperSizePresets: () => api.get<{ presets: DiaperBand[] }>('/inventory/diaper-size-presets'),
	preloadDiaperSizes: (data: { memberId: number; sizes?: { size: string; weightBandMinKg?: number | null; weightBandMaxKg?: number | null }[]; itemId?: number | null }) =>
		api.post('/inventory/diaper-sizes/preload', data),
	addDiaperSize: (data: { memberId: number; size: string; itemId?: number | null; weightBandMinKg?: number | null; weightBandMaxKg?: number | null }) =>
		api.post('/inventory/diaper-sizes', data),
	updateDiaperSize: (id: number, data: Partial<{ size: string; itemId?: number | null; active: boolean; weightBandMinKg?: number | null; weightBandMaxKg?: number | null }>) =>
		api.put(`/inventory/diaper-sizes/${id}`, data),
	retireDiaperSize: (id: number) => api.delete(`/inventory/diaper-sizes/${id}`),
};

export interface NotifySchedule {
	enabled: boolean;
	running: boolean;
	intervalMinutes: number;
}

export interface NotifySummary {
	total: number;
	activity: number;
	inventory: number;
}

export const notificationsAPI = {
	status: () => api.get<NotifySchedule>('/notifications/status'),
	summary: () => api.get<NotifySummary>('/notifications/summary'),
};

export const remindersAPI = {
  list: () => api.get<{ reminders: Reminder[] }>('/reminders'),
  catalog: () => api.get<{ categories: ReminderCatalogCategory[] }>('/reminders/catalog'),
  create: (data: { kind: 'inactivity' | 'interval'; category?: string; conditions?: ReminderCondition[]; match?: ReminderMatch; targetType?: 'member' | 'home'; targetId?: number; label?: string; hours?: number; intervalDays?: number }) =>
    api.post('/reminders', data),
  update: (id: number, data: Partial<{ kind: 'inactivity' | 'interval'; category?: string; conditions?: ReminderCondition[]; match?: ReminderMatch; targetType?: 'member' | 'home'; targetId?: number; label?: string; hours?: number; intervalDays?: number; enabled?: boolean }>) =>
    api.put(`/reminders/${id}`, data),
  done: (id: number) => api.post(`/reminders/${id}/done`),
  remove: (id: number) => api.delete(`/reminders/${id}`),
};
