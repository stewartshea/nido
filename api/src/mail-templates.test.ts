// src/mail-templates.test.ts
import { describe, it, expect } from 'vitest';
import {
	renderVerifyEmail,
	renderPasswordResetEmail,
	renderFamilyInviteEmail,
	renderSmtpTestEmail,
} from './mail-templates';

const URL = 'https://nido.test/join?family=abc&token=xyz';

describe('mail templates', () => {
	it('renders every template with subject, text and html parts', () => {
		const all = [
			renderVerifyEmail({ firstName: 'Ada', url: URL }),
			renderPasswordResetEmail({ firstName: 'Ada', url: URL }),
			renderFamilyInviteEmail({ inviterName: 'Ada', familyName: 'Lovelaces', url: URL }),
			renderSmtpTestEmail({ to: 'ada@example.com' }),
		];
		for (const mail of all) {
			expect(mail.subject.length).toBeGreaterThan(0);
			expect(mail.text.length).toBeGreaterThan(0);
			expect(mail.html).toContain('<!doctype html>');
		}
	});

	it('keeps the action link in both the text and html parts', () => {
		for (const mail of [renderVerifyEmail({ url: URL }), renderPasswordResetEmail({ url: URL })]) {
			expect(mail.text).toContain(URL);
			expect(mail.html).toContain('href="https://nido.test/join?family=abc&amp;token=xyz"');
		}
	});

	// A co-parent controls the family name and their own display name, and both
	// are interpolated into HTML that lands in another person's inbox. Unescaped
	// markup here is stored-XSS-adjacent: it would let one family member inject
	// arbitrary HTML into every member's mail client.
	it('escapes untrusted values interpolated into html', () => {
		const mail = renderFamilyInviteEmail({
			inviterName: '<script>alert(1)</script>',
			familyName: '"><img src=x onerror=alert(2)>',
			url: URL,
		});
		expect(mail.html).not.toContain('<script>');
		expect(mail.html).not.toContain('<img');
		expect(mail.html).toContain('&lt;script&gt;');
		expect(mail.html).toContain('&lt;img src=x');
	});

	it('escapes a url containing ampersands instead of breaking the markup', () => {
		const mail = renderVerifyEmail({ url: 'https://nido.test/?verify=a&b=c' });
		expect(mail.html).toContain('https://nido.test/?verify=a&amp;b=c');
	});

	it('names the inviting account and family in the invite subject', () => {
		const mail = renderFamilyInviteEmail({ inviterName: 'Ada', familyName: 'Lovelaces', url: URL });
		expect(mail.subject).toContain('Ada');
		expect(mail.subject).toContain('Lovelaces');
	});

	it('falls back to a neutral greeting when no first name is known', () => {
		expect(renderVerifyEmail({ firstName: null, url: URL }).text).toContain('Hi,');
		expect(renderFamilyInviteEmail({ inviterName: '  ', familyName: 'Rivera', url: URL }).subject)
			.toContain('Someone');
	});

	it('never leaks a raw interpolation into the html without escaping', () => {
		const mail = renderFamilyInviteEmail({ familyName: 'a&b<c>"d"', url: URL });
		expect(mail.html).toContain('a&amp;b&lt;c&gt;&quot;d&quot;');
	});
});
