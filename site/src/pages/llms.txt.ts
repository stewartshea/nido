import type { APIRoute } from 'astro';
import { SITE_BASE } from '../site.config';

// A curated, machine-readable index for LLMs and agents (the llms.txt
// convention). Generated rather than static so every URL follows the site's
// configured origin and base.
export const prerender = true;

const site = (import.meta.env.SITE ?? '').replace(/\/$/, '');
const base = SITE_BASE.replace(/\/$/, '');
const url = (route: string) => `${site}${base}/${route.replace(/^\//, '')}`;

const BODY = `# Nido

> Nido (巣, "nest") is a free, open source, self-hosted tracker for a family and a home. It starts as an infant log — feeds, diapers, sleep, growth, milestones, vaccinations, appointments, journal — and grows to cover the household: inventory, homes, home assets, meters, schedules, and a maintenance log. It runs no model, has no telemetry, and can connect to an AI agent you run over MCP. Self-host it with Docker, or use My Nido, hosted in Canada.

- License: Apache-2.0. Free forever, self-hosted or hosted, with no feature withheld.
- Data: one SQLCipher-encrypted SQLite file per family; the file is the tenant boundary.
- Agent access: an embedded MCP server at POST /mcp (Streamable HTTP), authenticated with an opaque per-family token. Nido runs no model; the agent is a client you run.
- Source: https://github.com/stewartshea/nido

## Docs

- [Overview](${url('/')}): what Nido is and how to get it.
- [Features](${url('features/')}): everything the app does today.
- [Self-hosting](${url('self-host/')}): run it with Docker.
- [My Nido](${url('my-nido/')}): the hosted option, in Canada.
- [User guide](${url('guides/user-guide/')}): day-to-day use.
- [Agent access (MCP)](${url('reference/agent-access/')}): connect an AI agent, with the full tool list.
- [Security model](${url('reference/security/')}): what Nido encrypts and the threat model.
- [Architecture](${url('reference/architecture/')}): the namespace-per-family design.
- [Configuration](${url('reference/configuration/')}): environment variables.
- [Backup & restore](${url('guides/backup-and-restore/')}).
- [Roadmap](${url('project/roadmap/')}).

## Optional

- [Full documentation as one file](${url('llms-full.txt')}): every docs page concatenated.
- [Contributing](${url('project/contributing/')}).
- [Support Nido](${url('support/')}).
`;

export const GET: APIRoute = () =>
	new Response(BODY, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
