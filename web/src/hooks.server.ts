import type { Handle } from '@sveltejs/kit';

const API_TARGET = (process.env.API_PROXY_TARGET || 'http://localhost:3000').replace(/\/+$/, '');

const HOP_BY_HOP = new Set([
	'host',
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
]);

const STRIP_FROM_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname, search } = event.url;
	if (!pathname.startsWith('/api/')) return resolve(event);

	const headers = new Headers();
	for (const [key, value] of event.request.headers) {
		if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
	}

	const method = event.request.method;
	const hasBody = method !== 'GET' && method !== 'HEAD';

	const init: RequestInit & { duplex?: 'half' } = { method, headers };
	if (hasBody) {
		init.body = event.request.body;
		init.duplex = 'half';
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${API_TARGET}${pathname}${search}`, init);
	} catch {
		return new Response(JSON.stringify({ error: 'API unreachable' }), {
			status: 502,
			headers: { 'content-type': 'application/json' },
		});
	}

	const responseHeaders = new Headers();
	for (const [key, value] of upstream.headers) {
		if (!STRIP_FROM_RESPONSE.has(key.toLowerCase())) responseHeaders.set(key, value);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
};
