// All outbound email copy lives here instead of inline at the call sites, so
// branding, tone and layout change in exactly one place. Renderers are pure
// functions of their input (no clock, no env, no network) so they can be
// asserted in tests without a mail server.
//
// Colours mirror web/src/app.css and web/static/favicon.svg: a deep forest
// green shell, cream paper, and the nest gold as the single accent.

export interface RenderedEmail {
	subject: string;
	text: string;
	html: string;
}

const BRAND = {
	ink: '#1E2A1D',
	cream: '#F7F5F0',
	gold: '#CFAD5E',
	muted: '#5C665A',
} as const;

// Every interpolated value passes through here. Subject and family names are
// attacker-controllable, and an unescaped "<" would let a co-parent inject
// markup into mail that lands in someone else's inbox.
function esc(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
	);
}

// Table-based rather than flex/grid: Outlook's Word engine ignores modern
// layout, and a call-to-action that collapses to an unstyled block is worse
// than no button at all.
function layout(opts: {
	preheader: string;
	heading: string;
	intro: string;
	cta?: { label: string; url: string };
	footnote?: string;
	closing: string;
}): string {
	const button = opts.cta
		? `<tr><td style="padding:8px 32px 24px 32px;">
				<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
					<td bgcolor="${BRAND.gold}" style="border-radius:10px;">
						<a href="${esc(opts.cta.url)}" style="display:inline-block;padding:14px 28px;
							font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
							color:${BRAND.ink};text-decoration:none;border-radius:10px;">${esc(opts.cta.label)}</a>
					</td>
				</tr></table>
			</td></tr>`
		: '';

	// The fallback URL is shown as selectable text so the email is still usable
	// in clients that strip the button or block remote images.
	const fallback = opts.cta
		? `<p style="margin:0 0 24px 0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};word-break:break-all;">
				Or paste this link into your browser:<br>
				<a href="${esc(opts.cta.url)}" style="color:${BRAND.ink};">${esc(opts.cta.url)}</a>
			</p>`
		: '';

	const footnote = opts.footnote
		? `<p style="margin:0 0 16px 0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};">${esc(opts.footnote)}</p>`
		: '';

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
	<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</span>
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};padding:32px 12px;">
		<tr><td align="center">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
				style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;
				border:1px solid rgba(30,42,29,0.08);">
				<tr><td style="height:6px;line-height:6px;font-size:0;background:${BRAND.gold};">&nbsp;</td></tr>
				<tr><td style="padding:32px 32px 0 32px;">
					<p style="margin:0 0 20px 0;font:600 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
					letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.gold};">Nido</p>
					<h1 style="margin:0 0 12px 0;font:600 24px/1.3 Georgia,'Times New Roman',serif;color:${BRAND.ink};">${esc(opts.heading)}</h1>
					<p style="margin:0;font:400 15px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">${esc(opts.intro)}</p>
				</td></tr>
				${button}
				<tr><td style="padding:0 32px 32px 32px;">
					${fallback}
					${footnote}
					<p style="margin:0;font:400 15px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">${esc(opts.closing)}</p>
				</td></tr>
			</table>
			<p style="margin:16px 0 0 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};">
				Sent by Nido &middot; if this wasn't you, no action is needed.
			</p>
		</td></tr>
	</table>
</body></html>`;
}

function greeting(name?: string | null): string {
	const trimmed = String(name ?? '').trim();
	return trimmed ? `Hi ${trimmed},` : 'Hi,';
}

export function renderVerifyEmail(opts: { firstName?: string | null; url: string }): RenderedEmail {
	return {
		subject: 'Verify your Nido email',
		text: [
			greeting(opts.firstName),
			'',
			'Confirm your Nido account by opening the link below (valid 24 hours):',
			opts.url,
			'',
			'If you did not create this account, you can ignore this email.',
		].join('\n'),
		html: layout({
			preheader: 'Confirm your email address to finish setting up Nido.',
			heading: 'Confirm your email',
			intro: `${greeting(opts.firstName)} confirm your email address to finish setting up your Nido account. This link is valid for 24 hours.`,
			cta: { label: 'Verify my email', url: opts.url },
			footnote: 'If you did not create this account, you can ignore this email.',
			closing: 'Talk soon,',
		}),
	};
}

export function renderPasswordResetEmail(opts: { firstName?: string | null; url: string }): RenderedEmail {
	return {
		subject: 'Reset your Nido password',
		text: [
			greeting(opts.firstName),
			'',
			'Reset your Nido password by opening the link below:',
			opts.url,
			'',
			'If you did not request a password reset, you can ignore this email — your password stays as it is.',
		].join('\n'),
		html: layout({
			preheader: 'A password reset was requested for your Nido account.',
			heading: 'Reset your password',
			intro: `${greeting(opts.firstName)} someone requested a password reset for your Nido account. Use the button below to choose a new one.`,
			cta: { label: 'Reset my password', url: opts.url },
			footnote: 'If you did not request this, ignore this email — your password stays as it is.',
			closing: 'Talk soon,',
		}),
	};
}

export function renderFamilyInviteEmail(opts: {
	inviterName?: string | null;
	familyName: string;
	url: string;
}): RenderedEmail {
	const from = String(opts.inviterName ?? '').trim() || 'Someone';
	return {
		subject: `${from} invited you to join ${opts.familyName} on Nido`,
		text: [
			greeting(null),
			'',
			`${from} invited you to join "${opts.familyName}" on Nido, so you can help track feeding, sleep, and everything else that matters.`,
			'',
			'Accept the invitation by opening the link below:',
			opts.url,
			'',
			"You'll need to be signed in to Nido with the email address this invitation was sent to.",
			'',
			'If you were not expecting this, you can ignore this email.',
		].join('\n'),
		html: layout({
			preheader: `${from} invited you to join ${opts.familyName} on Nido.`,
			heading: `Join ${opts.familyName}`,
			intro: `${from} invited you to join “${opts.familyName}” on Nido, so you can help track feeding, sleep, and everything else that matters.`,
			cta: { label: 'Accept invitation', url: opts.url },
			footnote: `You'll need to be signed in to Nido with the email address this invitation was sent to. If you were not expecting this, you can ignore this email.`,
			closing: 'Talk soon,',
		}),
	};
}

export function renderSmtpTestEmail(opts: { to: string }): RenderedEmail {
	return {
		subject: 'Nido — SMTP test',
		text: [
			'This is a test email from Nido.',
			'',
			`SMTP is configured correctly. Delivered to ${opts.to}.`,
		].join('\n'),
		html: layout({
			preheader: 'Your Nido outbound email settings are working.',
			heading: 'Email is working',
			intro: 'This is a test message from Nido, sent to confirm your outbound email settings are configured correctly.',
			footnote: `Delivered to ${opts.to}. You can close this message — nothing else to do.`,
			closing: 'Talk soon,',
		}),
	};
}
