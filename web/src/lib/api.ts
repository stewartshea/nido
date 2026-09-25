// src/lib/api.ts
import axios from 'axios';

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
  (response) => response,
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

// Decode the current user's ID from the stored JWT, if present.
export function getUserId(): number | null {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  if (!token) return null;
  return decodeJwtPayload(token)?.userId ?? null;
}

// Auth API functions
export const authAPI = {
  register: (userData: { email: string; password: string; firstName: string; lastName: string }) => 
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
export const babyAPI = {
  getAll: () => api.get('/babies'),
  getById: (id: number) => api.get(`/babies/${id}`),
  create: (babyData: { name: string; birthDate: string; gender?: string; householdId: number }) => 
    api.post('/babies', babyData),
  update: (id: number, babyData: Partial<{ name: string; birthDate: string; gender?: string }>) => 
    api.put(`/babies/${id}`, babyData),
  delete: (id: number) => api.delete(`/babies/${id}`),
};

// Family API functions — family-first model
export const familiesAPI = {
  list: () => api.get('/families'),
  create: (data: { name: string; member?: { type: string; name: string; birthDate?: string; gender?: string } }) =>
    api.post('/families', data),
  members: (familyId: string) => api.get(`/families/${familyId}/members`),
  addMember: (familyId: string, data: { type?: string; name: string; birthDate?: string; gender?: string }) =>
    api.post(`/families/${familyId}/members`, data),
  updateMember: (familyId: string, memberId: number, data: { type?: string; categories?: string[] }) =>
    api.put(`/families/${familyId}/members/${memberId}`, data),
  removeMember: (familyId: string, memberId: number) =>
    api.delete(`/families/${familyId}/members/${memberId}`),
  invite: (familyId: string, email: string) =>
    api.post(`/families/${familyId}/invitations`, { email }),
  listInvites: (familyId: string) => api.get(`/families/${familyId}/invitations`),
  revokeInvite: (familyId: string, inviteId: number) =>
    api.delete(`/families/${familyId}/invitations/${inviteId}`),
  join: (token: string) => api.post('/families/join', { token }),
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
  updateSettings: (familyId: string, data: { categories?: string[]; categoryOptions?: Record<string, Record<string, string[]>> }) =>
    api.put(`/families/${familyId}/settings`, data),
};

// Feeding API functions
export const feedingAPI = {
  getAll: (babyId: number) => api.get(`/feedings?babyId=${babyId}`),
  getById: (id: number) => api.get(`/feedings/${id}`),
  create: (feedingData: { babyId: number; startTime: string; endTime?: string; amount?: number; type: 'breast' | 'formula' | 'solid'; side?: 'left' | 'right' | 'both'; notes?: string }) => 
    api.post('/feedings', feedingData),
  update: (id: number, feedingData: Partial<{ startTime: string; endTime?: string; amount?: number; type: 'breast' | 'formula' | 'solid'; side?: 'left' | 'right' | 'both'; notes?: string }>) => 
    api.put(`/feedings/${id}`, feedingData),
  delete: (id: number) => api.delete(`/feedings/${id}`),
};

// Diaper API functions
export const diaperAPI = {
  getAll: (babyId: number) => api.get(`/diapers?babyId=${babyId}`),
  getById: (id: number) => api.get(`/diapers/${id}`),
  create: (diaperData: { babyId: number; changeTime: string; type: 'wet' | 'dirty' | 'both'; color?: string; consistency?: string; notes?: string }) => 
    api.post('/diapers', diaperData),
  update: (id: number, diaperData: Partial<{ changeTime: string; type: 'wet' | 'dirty' | 'both'; color?: string; consistency?: string; notes?: string }>) => 
    api.put(`/diapers/${id}`, diaperData),
  delete: (id: number) => api.delete(`/diapers/${id}`),
};

// Sleep API functions
export const sleepAPI = {
  getAll: (babyId: number) => api.get(`/sleep?babyId=${babyId}`),
  getById: (id: number) => api.get(`/sleep/${id}`),
  create: (sleepData: { babyId: number; startTime: string; endTime?: string; location?: string; notes?: string }) => 
    api.post('/sleep', sleepData),
  update: (id: number, sleepData: Partial<{ startTime: string; endTime?: string; location?: string; notes?: string }>) => 
    api.put(`/sleep/${id}`, sleepData),
  delete: (id: number) => api.delete(`/sleep/${id}`),
};

// Growth API functions
export const growthAPI = {
  getAll: (babyId: number) => api.get(`/growth?babyId=${babyId}`),
  getById: (id: number) => api.get(`/growth/${id}`),
  getChartData: (id: number) => api.get(`/growth/${id}/chart-data`),
  create: (growthData: { babyId: number; measurementDate: string; weight?: number; height?: number; headCircumference?: number; bmi?: number; unitSystem?: 'imperial' | 'metric'; notes?: string }) => 
    api.post('/growth', growthData),
  update: (id: number, growthData: Partial<{ measurementDate: string; weight?: number; height?: number; headCircumference?: number; bmi?: number; unitSystem?: 'imperial' | 'metric'; notes?: string }>) => 
    api.put(`/growth/${id}`, growthData),
  delete: (id: number) => api.delete(`/growth/${id}`),
};

// Milestone API functions
export const milestoneAPI = {
  getAll: (babyId: number) => api.get(`/milestones?babyId=${babyId}`),
  getById: (id: number) => api.get(`/milestones/${id}`),
  getCategories: () => api.get('/milestones/categories'),
  create: (milestoneData: { babyId: number; title: string; description?: string; achievedDate: string; category?: string }) => 
    api.post('/milestones', milestoneData),
  update: (id: number, milestoneData: Partial<{ title: string; description?: string; achievedDate: string; category?: string }>) => 
    api.put(`/milestones/${id}`, milestoneData),
  delete: (id: number) => api.delete(`/milestones/${id}`),
};

// Vaccination API functions
export const vaccinationAPI = {
  getAll: (babyId: number) => api.get(`/vaccinations?babyId=${babyId}`),
  getById: (id: number) => api.get(`/vaccinations/${id}`),
  getSchedule: () => api.get('/vaccinations/schedule'),
  create: (vaccinationData: { babyId: number; name: string; dateGiven?: string; nextDueDate?: string; administeredBy?: string; notes?: string }) => 
    api.post('/vaccinations', vaccinationData),
  update: (id: number, vaccinationData: Partial<{ name: string; dateGiven?: string; nextDueDate?: string; administeredBy?: string; notes?: string }>) => 
    api.put(`/vaccinations/${id}`, vaccinationData),
  delete: (id: number) => api.delete(`/vaccinations/${id}`),
};

export const moodAPI = {
  getAll: (babyId: number) => api.get(`/moods?babyId=${babyId}`),
  create: (data: { babyId: number; mood: string; recordedAt?: string; notes?: string }) =>
    api.post('/moods', data),
  update: (id: number, data: Partial<{ mood: string; recordedAt?: string; notes?: string }>) =>
    api.put(`/moods/${id}`, data),
  delete: (id: number) => api.delete(`/moods/${id}`),
};

export const journalAPI = {
  getAll: (babyId: number) => api.get(`/journal?babyId=${babyId}`),
  create: (data: { babyId: number; title?: string; body?: string; entryDate?: string }) =>
    api.post('/journal', data),
  update: (id: number, data: Partial<{ title?: string; body?: string; entryDate?: string }>) =>
    api.put(`/journal/${id}`, data),
  delete: (id: number) => api.delete(`/journal/${id}`),
};

// Health API functions
export const healthAPI = {
  getSummary: (babyId: number) => api.get(`/health/summary/${babyId}`),
  getInsights: (babyId: number) => api.get(`/health/insights/${babyId}`),
};

// Import API functions (Narababy CSV upload + per-family summary)
export const importsAPI = {
  narababy: (file: File, babyId?: number | null, importType?: string) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (babyId) form.append('babyId', String(babyId));
    if (importType) form.append('importType', importType);
    return api.post('/imports/narababy', form, {
      headers: { 'Content-Type': undefined },
    });
  },
  runs: (babyId?: number | null) => api.get(`/imports/runs${babyId ? `?babyId=${babyId}` : ''}`),
  undoRun: (runId: number) => api.post(`/imports/runs/${runId}/undo`),
  summary: () => api.get('/imports/summary'),
};

// Photos API — multi-tenant: every photo is family-scoped server-side.
export const photosAPI = {
  list: (parentType: string, parentId: number) =>
    api.get(`/photos?parentType=${parentType}&parentId=${parentId}`),
  upload: (parentType: string, parentId: number, file: File) => {
    const form = new FormData();
    form.append('parentType', parentType);
    form.append('parentId', String(parentId));
    form.append('file', file, file.name);
    return api.post('/photos', form, { headers: { 'Content-Type': undefined } });
  },
  // Fetch image bytes with auth (plain <img> can't carry the JWT).
  file: (id: number) =>
    api.get(`/photos/${id}/file`, { responseType: 'blob' }),
  url: (id: number) => `/api/v1/photos/${id}/file`,
  remove: (id: number) => api.delete(`/photos/${id}`),
};

// Formulas API — family-scoped formula catalog.
export const formulasAPI = {
  list: (familyId: string) => api.get(`/formulas?familyId=${familyId}`),
  create: (familyId: string, data: { name: string; brand?: string }) =>
    api.post('/formulas', { familyId, ...data }),
  update: (id: number, data: { name?: string; brand?: string | null }) =>
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
};

export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (data: { signupEnabled?: boolean; emailVerification?: boolean; smtpHost?: string | null; smtpPort?: number | null; smtpUser?: string | null; smtpPass?: string | null; smtpFrom?: string | null }) =>
    api.put('/settings', data),
  test: () => api.post('/settings/test'),
};

export const remindersAPI = {
  list: () => api.get('/reminders'),
  create: (data: { kind: 'inactivity' | 'interval'; category?: string; targetType?: 'member' | 'home'; targetId?: number; label?: string; hours?: number; intervalDays?: number }) =>
    api.post('/reminders', data),
  update: (id: number, data: Partial<{ kind: 'inactivity' | 'interval'; category?: string; targetType?: 'member' | 'home'; targetId?: number; label?: string; hours?: number; intervalDays?: number; enabled?: boolean }>) =>
    api.put(`/reminders/${id}`, data),
  done: (id: number) => api.post(`/reminders/${id}/done`),
  remove: (id: number) => api.delete(`/reminders/${id}`),
};