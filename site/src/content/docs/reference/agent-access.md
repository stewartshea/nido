---
title: Agent access (MCP)
description: Connect an AI agent to your Nido family over the Model Context Protocol — read the household, and log against it, with no model running inside Nido.
head:
  - tag: script
    attrs:
      type: application/ld+json
    content: |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Does Nido include an AI model?","acceptedAnswer":{"@type":"Answer","text":"No. Nido exposes its own operations as MCP tools but runs no model, generates no summaries, and adds no AI. The agent is a client you run; Nido is the tool server."}},
        {"@type":"Question","name":"How do I connect an AI agent to Nido?","acceptedAnswer":{"@type":"Answer","text":"Generate a token under Settings, Agent access, then point an MCP client at POST /mcp on your Nido host, using the token as a Bearer credential. The page produces a ready-to-paste MCP config."}},
        {"@type":"Question","name":"What can an agent do to my data?","acceptedAnswer":{"@type":"Answer","text":"It can read the family and log or correct records through the same validated routes the app uses, opening only that family's database. There is no delete tool, and every write carries who made it."}}
      ]}
---

Nido exposes its own operations as **MCP (Model Context Protocol)** tools. Point
an agent at Nido's MCP endpoint and it can read a family's records and log
against them through the same validated routes the web app uses.

Nido runs **no model**, generates **no summaries**, and adds **no "AI"**. There is
no background activity and nothing changes when no agent is attached. The agent
is a client you run, wherever you already run it; Nido is the tool server.

## Turning it on

1. Open **Settings → Agent access**.
2. Press **Generate token**. The token is shown **once** — copy it then. Nido
   stores only its SHA-256 hash. A label is optional, for telling tokens apart.
3. Copy the MCP config the page generates, or use the template below.
4. **Revoke** a token at any time; access ends at the next request.

Tokens do not expire. Revoking is the control.

## Connect an agent

The server speaks **Streamable HTTP** at `/mcp` on your Nido host, and
authenticates with the token as a bearer credential.

```json
{
  "mcpServers": {
    "nido": {
      "type": "http",
      "url": "https://nido.example.com/mcp",
      "headers": { "Authorization": "Bearer nido_mcp_…" }
    }
  }
}
```

Use the same shape for Claude Desktop, Cursor, and any other client that
supports a remote MCP server with a custom header. On **My Nido** the URL is
`https://my.nido-app.ca/mcp`; self-hosted, it is your own origin. The endpoint is
served by the same host as the app, so there is nothing else to open.

## What an agent can do

Every tool is a thin shell over a route Nido already has, so an agent read is
the same read the app makes and an agent write is a normal write — it appears in
the log with its provenance.

### Read

| Tool | Answers |
| --- | --- |
| `list_children` | who can be logged against, with stage and tracked categories |
| `get_feedings`, `get_diapers`, `get_sleep` | a child's records over a date range |
| `get_growth` | measurements with WHO/CDC age percentiles |
| `get_milestones` | firsts and other dated milestones |
| `get_vaccinations` | doses given, optionally with the recommended schedule |
| `get_appointments` | upcoming and booked appointments |
| `get_journal` | free-text journal entries |
| `get_family_summary` | a bounded rollup — counts and totals — so "how was the week" is one call |
| `list_homes`, `list_assets` | residences and the durable things in them |
| `list_meters` | odometer/usage meters and their schedule status |
| `whats_due` | everything due across assets, overdue first |
| `get_maintenance_log` | what was done, when, what it cost |
| `list_inventory` | consumable stock with low-stock alerts |

### Write

| Tool | Does |
| --- | --- |
| `log_feed`, `log_diaper`, `log_sleep`, `log_growth`, `log_milestone`, `log_vaccination`, `add_journal_entry` | record a child's entry |
| `create_appointment` | book an appointment |
| `add_asset` | register a durable thing the family owns |
| `add_meter_reading` | record a meter reading |
| `log_maintenance` | record maintenance against an asset |
| `adjust_inventory`, `recount_inventory` | adjust stock by a delta with a reason, or set a counted quantity |
| `update_feed`, `update_diaper`, `update_sleep`, `update_growth`, `update_milestone`, `update_vaccination`, `update_journal_entry`, `reschedule_appointment`, `update_asset`, `update_maintenance` | correct what was logged |

There is deliberately **no delete tool**. A delete is destructive and
irreversible; it is out of scope for the agent surface, which is additive and
correctable.

### Resource

`nido://family/export` — the whole family as JSON, the same payload as
**Export**, so an agent can pull everything in one call. Owner/admin only.

## How it stays safe

- **The token resolves to exactly one family.** Every call opens only that
  family's database — the same tenant boundary as the rest of Nido. A tool
  cannot widen its scope, and there is no second path to the data.
- **Only a hash is stored.** The token is a bearer credential: never logged,
  never shown again after creation. Unknown and revoked tokens get the same
  answer, so there is nothing to probe.
- **Writes are ordinary writes.** They carry the account that created the token
  as their author and pass the same validation as the app.
- **Rate limited** per token (120 requests a minute), so a runaway agent cannot
  hammer the database.

See the [Security model →](./security/) for the wider picture.

## What the agent does not get

- No model call, no summarising, no scheduled activity — nothing runs inside
  Nido.
- No new way into the data: every tool maps to an existing route or evaluator.
- No delete. No change to what the app does when no agent is attached.

## Availability

Agent access is part of Nido and is the same in both [self-hosted](../self-host/)
and [My Nido](../my-nido/) installs. Only an owner or admin can create or revoke
a token.
