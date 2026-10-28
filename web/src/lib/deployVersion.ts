// deployVersion.ts
//
// A hand-rolled replacement for the `updated` store from `$app/stores`,
// without importing it. Kit re-implemented `$app/stores` on top of a
// Svelte-5 runes module (client/state.svelte.js); on this Svelte-4 app that
// module survives the production build untransformed and its runtime
// "is this old svelte?" string-match loses to bundler formatting, throwing
// `$state is not defined` on the server. The API this uses instead —
// `version` from `$app/environment` and the documented `/_app/version.json`
// endpoint — is exactly what the store was polling under the hood.
import { browser, version } from '$app/environment';

/** Fetch the deployed build version, or null when the endpoint is missing. */
async function deployedVersion(): Promise<string | null> {
	try {
		const res = await fetch('/_app/version.json', { cache: 'no-store' });
		if (!res.ok) return null;
		const body = (await res.json()) as { version?: string };
		return body.version ?? null;
	} catch {
		return null;
	}
}

/**
 * Reload the window when a deploy has changed the build version.
 *
 * Mirrors the old subscription's behavior: an immediate check, a poll every
 * `pollMs` (svelte.config.js sets `version.pollInterval` to 60s), and the
 * same focus/visibility listeners the layout used to register. Reloading is
 * safe — unsent writes sit in the offline outbox and replay on remount.
 *
 * Returns the teardown (remove listeners, clear the interval).
 */
export function watchForDeploy(pollMs = 60_000): () => void {
	if (!browser) return () => {};

	let stopped = false;

	async function check(): Promise<void> {
		if (stopped) return;
		const deployed = await deployedVersion();
		// `version` is this build's id; a different one means a new deploy
		// is live and this shell is stale.
		if (deployed && deployed !== version) {
			location.reload();
		}
	}

	void check();
	const timer = setInterval(() => void check(), pollMs);
	const onFocus = () => void check();
	const onVisibility = () => {
		if (document.visibilityState === 'visible') void check();
	};
	window.addEventListener('focus', onFocus);
	document.addEventListener('visibilitychange', onVisibility);

	return () => {
		stopped = true;
		clearInterval(timer);
		window.removeEventListener('focus', onFocus);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}