// src/lib/api/records.ts — the per-member tracked records: feedings, diapers,
// sleep, growth, milestones, vaccinations, moods, journal, health insights,
// vitals, and medications.
import type { MilestoneKind } from '$lib/shared';
import api from './client';
import type { PageOptions, Vital, Medication, MedicationFrequency } from './types';

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
  create: (diaperData: { memberId: number; changeTime: string; type: 'wet' | 'dirty' | 'both' | 'dry'; color?: string; consistency?: string; notes?: string }) => 
    api.post('/diapers', diaperData),
  update: (id: number, diaperData: Partial<{ changeTime: string; type: 'wet' | 'dirty' | 'both' | 'dry'; color?: string; consistency?: string; notes?: string }>) => 
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
  getUpcoming: (opts?: { memberId?: number; days?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.memberId) qs.set('memberId', String(opts.memberId));
    if (opts?.days) qs.set('days', String(opts.days));
    const q = qs.toString();
    return api.get(`/milestones/upcoming${q ? `?${q}` : ''}`);
  },
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

export const vitalsAPI = {
  getAll: (memberId: number) => api.get<{ vitals: Vital[]; total: number }>(`/vitals?memberId=${memberId}`),
  getPage: (memberId: number, opts?: PageOptions) =>
    api.get<{ vitals: Vital[]; total: number }>(`/vitals?memberId=${memberId}${pageQuery(opts)}`),
  create: (data: { memberId: number; kind: string; systolic?: number; diastolic?: number; value?: number; recordedAt?: string; notes?: string }) =>
    api.post<{ vital: Vital }>('/vitals', data),
  update: (id: number, data: Partial<{ kind: string; systolic: number | null; diastolic: number | null; value: number | null; recordedAt: string; notes: string | null }>) =>
    api.put<{ vital: Vital }>(`/vitals/${id}`, data),
  delete: (id: number) => api.delete(`/vitals/${id}`),
};

export const medicationAPI = {
  list: (memberId: number) =>
    api.get<{ medications: Medication[]; frequencies: MedicationFrequency[] }>(`/medications?memberId=${memberId}`),
  due: () => api.get<{ medications: Medication[] }>('/medications/due'),
  create: (data: { memberId: number; name: string; dose?: string; frequency?: string; startDate?: string; endDate?: string; notes?: string }) =>
    api.post<{ medication: Medication }>('/medications', data),
  update: (id: number, data: Partial<{ name: string; dose: string | null; frequency: string; startDate: string; endDate: string | null; notes: string | null; active: boolean }>) =>
    api.put<{ medication: Medication }>(`/medications/${id}`, data),
  delete: (id: number) => api.delete(`/medications/${id}`),
  dose: (id: number, occurredAt?: string) =>
    api.post<{ medication: Medication; event: unknown }>(`/medications/${id}/doses`, occurredAt ? { occurredAt } : {}),
};
