import { writable } from 'svelte/store';
import { browser } from '$app/environment';

interface UiState {
  accountPanelOpen: boolean;
  section: 'dashboard' | 'family' | 'home' | 'account';
}

const initialUiState: UiState = {
  accountPanelOpen: false,
  section: 'dashboard',
};

if (browser) {
  const savedSection = localStorage.getItem('kamori.section');
  if (savedSection === 'dashboard' || savedSection === 'home' || savedSection === 'family' || savedSection === 'account') {
    initialUiState.section = savedSection;
  }
}

export const uiStore = writable<UiState>(initialUiState);

export const uiActions = {
  requestAccount: () => {
    uiStore.update(state => ({ ...state, accountPanelOpen: true }));
  },
  setSection: (section: 'dashboard' | 'family' | 'home' | 'account') => {
    uiStore.update(state => ({ ...state, section }));
    if (browser) {
      localStorage.setItem('kamori.section', section);
    }
  }
};