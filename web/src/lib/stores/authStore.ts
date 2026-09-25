// src/lib/stores/authStore.ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
}

const initialAuthState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true,
};

if (browser) {
  const token = localStorage.getItem('token');
  if (token) {
    initialAuthState.token = token;
    initialAuthState.isAuthenticated = true;
  }
}

export const authStore = writable<AuthState>(initialAuthState);

// Actions
export const authActions = {
  login: (token: string, user: User) => {
    authStore.update(state => ({
      ...state,
      token,
      user,
      isAuthenticated: true,
      loading: false,
    }));
    
    if (browser) {
      localStorage.setItem('token', token);
    }
  },

  logout: () => {
    authStore.update(state => ({
      ...state,
      token: null,
      user: null,
      isAuthenticated: false,
      loading: false,
    }));
    
    if (browser) {
      localStorage.removeItem('token');
    }
  },

  setLoading: (loading: boolean) => {
    authStore.update(state => ({
      ...state,
      loading,
    }));
  },

  setUser: (user: User) => {
    authStore.update(state => ({
      ...state,
      user,
    }));
  },
};