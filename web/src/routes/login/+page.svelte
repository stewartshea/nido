<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authAPI, tokenExpired } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { AlertCircle, Check } from 'lucide-svelte';

	let error = '';
	let notice = '';
	let loading = false;

	let view: 'signin' | 'register' | 'forgot' = 'signin';

	let email = '';
	let password = '';
	
	let regEmail = '';
	let regPassword = '';
	let regFirstName = '';
	let regLastName = '';
	
	let resetEmail = '';
	let resetRequestSent = false;
	let pendingResetToken = '';
	let resetNewPassword = '';
	let resetDone = false;

	// Invitation links land on /login?next=/join?... so the invite survives sign-in.
	// Only same-origin relative paths are honoured: "//evil.example" and
	// "https://evil.example" are both parsed as absolute and would turn the
	// post-login redirect into an open redirect.
	function nextPath(): string {
		if (!browser) return '/dashboard';
		const next = new URLSearchParams(window.location.search).get('next');
		return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
	}

	async function handleLogin(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;
		try {
			const res = await authAPI.login({ email, password });
			const { token, user } = res.data;
			authActions.login(token, {
				id: user.id,
				email: user.email,
				firstName: user.first_name ?? user.firstName,
				lastName: user.last_name ?? user.lastName,
				createdAt: user.created_at ?? user.createdAt,
			});
			if (browser) {
				goto(nextPath());
			}
		} catch (err: any) {
			error = err.response?.data?.error || 'Login failed. Check your credentials.';
		} finally {
			loading = false;
		}
	}

	async function handleRegister(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;
		if (!regFirstName || !regLastName) {
			error = 'First and last name are required.';
			loading = false;
			return;
		}
		try {
			const res = await authAPI.register({
				email: regEmail,
				password: regPassword,
				firstName: regFirstName,
				lastName: regLastName,
			});
			const { token, user, requiresEmailVerification } = res.data;
			if (requiresEmailVerification) {
				notice = res.data.message || 'Check your email to verify your account.';
				view = 'signin';
				return;
			}
			authActions.login(token, {
				id: user.id,
				email: user.email,
				firstName: user.first_name ?? user.firstName,
				lastName: user.last_name ?? user.lastName,
				createdAt: user.created_at ?? user.createdAt,
			});
			if (browser) {
				goto(nextPath());
			}
		} catch (err: any) {
			error = err.response?.data?.error || 'Registration failed.';
		} finally {
			loading = false;
		}
	}

	async function sendResetRequest(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			await authAPI.forgotPassword(resetEmail);
			resetRequestSent = true;
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to send reset link.';
		}
	}

	async function completeReset(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			await authAPI.resetPassword(pendingResetToken, resetNewPassword);
			resetDone = true;
			pendingResetToken = '';
			resetNewPassword = '';
			notice = 'Password updated — you can now sign in.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to reset password.';
		}
	}

	onMount(async () => {
		if (browser) {
			const params = new URLSearchParams(window.location.search);
			const verifyParam = params.get('verify');
			const resetParam = params.get('reset');
			if (verifyParam) {
				try {
					const res = await authAPI.verifyEmail(verifyParam);
					notice = res.data.message || 'Email verified.';
				} catch (err: any) {
					error = err.response?.data?.error || 'Verification failed.';
				}
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			if (resetParam) {
				pendingResetToken = resetParam;
				view = 'forgot';
				notice = 'Enter a new password to complete your password reset.';
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			const token = localStorage.getItem('token');
			if (token && !tokenExpired()) {
				goto(nextPath());
			}
		}
	});
</script>

<div class="min-h-[80vh] flex flex-col items-center justify-center px-4 py-8">
	<div class="text-center mb-8">
		<div class="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-accent/50 text-accent text-3xl font-light mb-4" aria-hidden="true">巣</div>
		<h1 class="text-4xl font-display font-bold text-ink mb-2">Nido</h1>
		<p class="text-base text-ink-soft italic">tending to the home</p>
	</div>

	<div class="w-full max-w-md bg-surface rounded-2xl shadow-card p-6 md:p-8 border border-line-soft">
		{#if error}
			<div class="mb-6 bg-danger border border-danger text-danger-text px-4 py-3 rounded-md text-sm"><AlertCircle class="w-4 h-4 inline mr-1 align-[-1px]" aria-hidden="true" />{error}</div>
		{/if}
		{#if notice}
			<div class="mb-6 bg-surface border border-line-soft text-ink-soft px-4 py-3 rounded-md text-sm"><Check class="w-4 h-4 inline mr-1 align-[-1px]" aria-hidden="true" />{notice}</div>
		{/if}

		{#if view === 'signin'}
			<h2 class="text-2xl font-display font-semibold mb-6 text-center">Sign In</h2>
			<form class="space-y-4" on:submit={handleLogin}>
				<div>
					<label for="email" class="block text-sm font-medium text-ink-soft mb-1">Email</label>
					<input type="email" id="email" bind:value={email} required class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="your@email.com" />
				</div>
				<div>
					<label for="password" class="block text-sm font-medium text-ink-soft mb-1">Password</label>
					<input type="password" id="password" bind:value={password} required class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="••••••••" />
				</div>
				<button type="submit" disabled={loading} class="w-full min-h-[44px] bg-primary text-on-primary py-2 px-4 rounded-xl hover:bg-primary disabled:opacity-50 font-semibold mt-2">
					{loading ? 'Signing in...' : 'Sign In'}
				</button>
			</form>
			<div class="mt-6 text-center space-y-3">
				<button type="button" on:click={() => (view = 'forgot')} class="block w-full text-sm text-ink-soft hover:text-ink min-h-[44px]">Forgot password?</button>
				<div class="border-t border-line-soft pt-4">
					<p class="text-sm text-ink-soft">Don't have an account?</p>
					<button type="button" on:click={() => (view = 'register')} class="mt-2 block w-full text-base font-semibold text-accent hover:underline min-h-[44px]">Create an account</button>
				</div>
			</div>
		{:else if view === 'register'}
			<h2 class="text-2xl font-display font-semibold mb-6 text-center">Create Account</h2>
			<form class="space-y-4" on:submit={handleRegister}>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="reg-first" class="block text-sm font-medium text-ink-soft mb-1">First Name</label>
						<input type="text" id="reg-first" bind:value={regFirstName} required class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="Jane" />
					</div>
					<div>
						<label for="reg-last" class="block text-sm font-medium text-ink-soft mb-1">Last Name</label>
						<input type="text" id="reg-last" bind:value={regLastName} required class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="Doe" />
					</div>
				</div>
				<div>
					<label for="reg-email" class="block text-sm font-medium text-ink-soft mb-1">Email</label>
					<input type="email" id="reg-email" bind:value={regEmail} required class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="your@email.com" />
				</div>
				<div>
					<label for="reg-password" class="block text-sm font-medium text-ink-soft mb-1">Password</label>
					<input type="password" id="reg-password" bind:value={regPassword} required minlength="6" class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="••••••••" />
				</div>
				<button type="submit" disabled={loading} class="w-full min-h-[44px] bg-primary text-on-primary py-2 px-4 rounded-xl hover:bg-primary disabled:opacity-50 font-semibold mt-2">
					{loading ? 'Creating account...' : 'Register'}
				</button>
			</form>
			<div class="mt-6 text-center border-t border-line-soft pt-4">
				<p class="text-sm text-ink-soft">Already have an account?</p>
				<button type="button" on:click={() => (view = 'signin')} class="mt-2 block w-full text-base font-semibold text-accent hover:underline min-h-[44px]">Sign in instead</button>
			</div>
		{:else if view === 'forgot'}
			<h2 class="text-2xl font-display font-semibold mb-6 text-center">Reset Password</h2>
			{#if pendingResetToken}
				<p class="text-ink-soft text-sm mb-4 text-center">Choose a new password for your account.</p>
				<form class="space-y-4" on:submit={completeReset}>
					<div>
						<label for="reset-new-password" class="block text-sm font-medium text-ink-soft mb-1">New password</label>
						<input type="password" id="reset-new-password" bind:value={resetNewPassword} required minlength="6" class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="••••••••" />
					</div>
					<button type="submit" class="w-full min-h-[44px] bg-primary text-on-primary py-2 px-4 rounded-xl hover:bg-primary font-semibold">Update password</button>
				</form>
				{#if resetDone}
					<p class="text-sm text-ink-soft mt-4 text-center">Password updated — you can now sign in.</p>
				{/if}
			{:else}
				<p class="text-ink-soft text-sm mb-4 text-center">Enter your email and we&rsquo;ll send a password reset link.</p>
				<form class="space-y-4" on:submit={sendResetRequest}>
					<div>
						<label for="reset-email" class="block text-sm font-medium text-ink-soft mb-1">Email</label>
						<input type="email" id="reset-email" bind:value={resetEmail} required class="w-full min-h-[44px] px-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-accent" placeholder="your@email.com" />
					</div>
					<button type="submit" class="w-full min-h-[44px] bg-primary text-on-primary py-2 px-4 rounded-xl hover:bg-primary font-semibold">Send reset link</button>
					{#if resetRequestSent}
						<p class="text-sm text-ink-soft mt-4 text-center">If that email exists, a reset link has been sent.</p>
					{/if}
				</form>
			{/if}
			<div class="mt-6 text-center border-t border-line-soft pt-4">
				<button type="button" on:click={() => (view = 'signin', resetRequestSent = false, resetDone = false)} class="block w-full text-base font-semibold text-ink-soft hover:text-ink min-h-[44px]">Back to sign in</button>
			</div>
		{/if}
	</div>
</div>