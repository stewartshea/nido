---
title: Reverse proxy & TLS
description: Put Nido behind a domain with Caddy, Traefik or nginx.
---

Nido speaks plain HTTP on ports `3000` (API) and `3001` (web). Terminating TLS
is the job of a reverse proxy in front of it.

## What to set

Three values, and getting them wrong is the usual reason a proxied Nido appears
to work but cannot log in.

| Variable | Value behind a proxy |
| --- | --- |
| `ALLOWED_HOSTS` | Your public hostname, e.g. `nido.example.com`. Defaults to `localhost`; IPs are always allowed. |
| `API_PROXY_TARGET` | Where the **web container** forwards `/api`. Inside Compose: `http://api:3000`. |
| `PUBLIC_URL` | The public origin, e.g. `https://nido.example.com` — **not** localhost. Used to build verification and password-reset links. |

`PUBLIC_URL` is the one that quietly breaks onboarding. Set to `localhost` and
your parent's verification email contains a link that only works on the server.

## The single-origin setup (recommended)

Point the proxy at the **web** service only. The browser calls the API
same-origin at `/api/v1`, and the web container proxies it to the API. No CORS,
one certificate, one hostname.

```text
nido.example.com {
	reverse_proxy 127.0.0.1:3001
}
```

That's the whole configuration. Caddy obtains and renews the certificate
automatically.

:::note[Why single-origin is easier]
Splitting web and API onto two hostnames works, but it means configuring CORS
on the API, a second certificate, and `PUBLIC_API_URL` pointing at the API
origin. The extra moving parts buy nothing here.
:::

## Traefik

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.nido.rule=Host(`nido.example.com`)
  - traefik.http.routers.nido.tls.certresolver=letsencrypt
  - traefik.http.services.nido.loadbalancer.server.port=3001
```

## nginx

```nginx
server {
	listen 443 ssl http2;
	server_name nido.example.com;

	ssl_certificate     /etc/letsencrypt/live/nido.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/nido.example.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:3001;
		proxy_set_header Host              $host;
		proxy_set_header X-Real-IP         $remote_addr;
		proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}

	# blobs can be large; the default 1m is a common surprise
	client_max_body_size 25m;
}
```

The `Host` header matters — it is what `ALLOWED_HOSTS` is checked against.

## Split origins (if you must)

```text
nido.example.com {
	reverse_proxy 127.0.0.1:3001
}

api.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Then set `PUBLIC_API_URL=https://api.example.com` and configure CORS on the
API. Only choose this if you need the API reachable independently.

## Exposing it to the internet

Nido is designed to be self-hosted, not to be hardened for the open internet.
If you put it on a public hostname:

- **Use a real domain and TLS.** Nido handles session JWTs; do not put it
  behind plain HTTP.
- **Turn off open registration.** `SIGNUP_ENABLED=false`.
- **Do not expose port `3000` publicly.** It is only reachable internally under
  the single-origin setup. In Compose, bind it to localhost if you must:
  `127.0.0.1:3000:3000`.
- **Consider a VPN instead.** Tailscale or WireGuard removes the public attack
  surface entirely and is a better fit for a family server than hardening
  every route for hostile traffic.
- **Keep it patched.** [Up to date on the roadmap](../project/roadmap/) is a
  standing item, not a done one.

:::caution[There is no upload size limit yet]
Photo uploads are validated by MIME type and scoped to the family, but there is
currently **no maximum file-size check**. Exposing an upload path to
untrusted or high-volume traffic is exactly the situation that makes that a
problem. Terminate at a proxy that caps `client_max_body_size` until the
limit lands.
:::

## Health check

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3001/ | head -1
```

Worth wiring the first into your monitoring — the API exits rather than
serving traffic when its secrets are misconfigured, so a silent API is the
expected failure mode of a bad `.env`.
