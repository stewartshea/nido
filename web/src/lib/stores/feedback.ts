// src/lib/stores/feedback.ts — the one toast mechanism (AGENTS.md: Feedback).
// Extracted verbatim from the notice/error block family/dashboard/home/settings
// each carried: one confirmation or one error, fixed top-right, 6s auto-dismiss.
import { writable } from 'svelte/store';

interface FeedbackState {
	notice: string;
	error: string;
}

export const feedback = writable<FeedbackState>({ notice: '', error: '' });

let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

function armFeedbackTimer(): void {
	if (feedbackTimer) clearTimeout(feedbackTimer);
	feedbackTimer = setTimeout(() => {
		feedbackTimer = undefined;
		feedback.set({ notice: '', error: '' });
	}, 6000);
}

/** Show a confirmation; replaces any error on screen — the two never stack. */
export function notify(message: string): void {
	feedback.set({ notice: message, error: '' });
	armFeedbackTimer();
}

/** Show an error; replaces any notice on screen. */
export function fail(message: string): void {
	feedback.set({ notice: '', error: message });
	armFeedbackTimer();
}

/** Dismiss whatever is showing (the toast's own × button). */
export function dismissFeedback(): void {
	if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = undefined; }
	feedback.set({ notice: '', error: '' });
}
