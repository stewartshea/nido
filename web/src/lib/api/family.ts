// src/lib/api/family.ts — identity and family membership: auth, the signed-in
// user, family members (baby is the first supported profile type), and the
// family's own management endpoints.
import api from './client';
import type { FamilyAccount } from './types';

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

/** A residence — a `homes` row (the H in the HOME modules). */
export interface Home {
  id: number;
  name: string;
  kind: string;
  address: string | null;
  timezone: string | null;
  isPrimary: boolean;
  picture: number | null;
}

export const familiesAPI = {
  list: () => api.get('/families'),
  create: (data: { name: string; member?: { type: string; name: string; birthDate?: string; gender?: string; email?: string } }) =>
    api.post('/families', data),
  members: (familyId: string) => api.get(`/families/${familyId}/members`),
  /** The family's residences — `homes` rows (the H in the HOME modules). */
  homes: (familyId: string) => api.get<{ homes: Home[] }>(`/families/${familyId}/homes`),
  addHome: (familyId: string, data: { name: string; kind?: string; address?: string | null; timezone?: string | null; isPrimary?: boolean }) =>
    api.post<{ home: Home }>(`/families/${familyId}/homes`, data),
  updateHome: (familyId: string, id: number, data: Partial<{ name: string; kind: string; address: string | null; timezone: string | null; isPrimary: boolean }>) =>
    api.put<{ home: Home }>(`/families/${familyId}/homes/${id}`, data),
  deleteHome: (familyId: string, id: number) => api.delete(`/families/${familyId}/homes/${id}`),
  getHomePicture: (familyId: string, id: number) =>
    api.get(`/families/${familyId}/homes/${id}/picture`, { responseType: 'blob' }),
  /**
   * FormData upload: the instance default Content-Type ('application/json',
   * set in client.ts) must be cleared or the browser never sets the multipart
   * boundary — the API then rejects the body with "Content-Type was not one
   * of multipart/form-data" (issue #76; same fix as uploadAvatar).
   */
  uploadHomePicture: (familyId: string, id: number, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return api.post(`/families/${familyId}/homes/${id}/picture`, form, {
      headers: { 'Content-Type': undefined },
    });
  },
  accounts: () => api.get<{ accounts: FamilyAccount[] }>('/families/accounts'),
  addMember: (familyId: string, data: { type?: string; name: string; birthDate?: string; gender?: string; email?: string; categories?: string[]; stage?: string; trackable?: boolean }) =>
    api.post(`/families/${familyId}/members`, data),
  updateMember: (familyId: string, memberId: number, data: { type?: string; name?: string; birthDate?: string | null; gender?: string | null; email?: string | null; categories?: string[]; stage?: string | null; quickLinks?: string[] | null; dashboardTiles?: string[] | null; trackable?: boolean }) =>
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
  updateSettings: (familyId: string, data: { categories?: string[]; categoryOptions?: Record<string, Record<string, string[]>>; stageCategories?: Record<string, string[]> | null; digestFrequency?: string; shareAnonymizedDaily?: boolean; appointmentNotifications?: boolean; feedGroupingMinutes?: number; timezone?: string | null; digestSendHour?: number | null; appointmentSendHour?: number | null }) =>
    api.put(`/families/${familyId}/settings`, data),
  getAnonymizedPreview: (familyId: string) => api.get(`/families/${familyId}/settings/anonymized-preview`),
};
