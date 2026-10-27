// src/lib/api/system.ts — instance-level endpoints: bulk imports (Narababy
// CSV), the formula catalog, family export/restore, own-account management,
// and the platform settings/overview/registry admin API.
import api from './client';
import type { SystemOverview, RegistryView } from './types';

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
  overview: () => api.get<{ overview: SystemOverview }>('/settings/overview'),
  registry: () => api.get<{ registry: RegistryView }>('/settings/registry'),
};
