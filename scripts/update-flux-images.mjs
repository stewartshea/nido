#!/usr/bin/env node
//
// Rewrites the nido image references in the ovh-flux repo to a release tag.
//
//   node scripts/update-flux-images.mjs --dir <ovh-flux>/clusters/prod-saz/nido --tag v2026.10.24
//
// The release workflow runs this after the images for a tag are in the
// registry, then commits the result: the ovh-flux repo is the deployment's
// source of truth, so a release rolling production IS a git commit Flux sees
// — the same rule everything else in that repo lives by.
//
// Plain string replacement, deliberately: the image lines are one-liners, a
// YAML rewrite library is a dependency for nothing, and the failure mode of a
// regex that matches too little is a visible diff where nothing changed.
//
// Covers every image the nido kustomization runs:
//   - api and web Deployments, which carry a `:tag`
//   - the backup Deployment, which ran a manually-pinned `@sha256:` digest
//     from before releases were tagged — pinned to the release tag it stays
//     in lockstep with the API it backs up, instead of silently drifting.
//
// Idempotent: already-at-tag is success, so re-running a release job cannot
// double-commit. Exits non-zero when nothing matched (wrong directory), when
// the tag is missing or `latest` (the whole point is an immutable ref), or
// when a file that should hold an image line does not.
//
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`\nupdate-flux-images: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

// Any nido image reference — :tag or @digest — on one `image:` line.
const IMAGE_LINE =
  /^(\s*image:\s*ghcr\.io\/stewartshea\/nido\/(?:api|web))(?::[\w.-]+|@sha256:[0-9a-f]+)(\s*)$/;

const { dir: dirArg, tag } = parseArgs(process.argv.slice(2));
if (!dirArg) fail('needs --dir <path to the ovh-flux nido kustomization>');
if (!tag) fail('needs --tag <release tag, e.g. v2026.10.24>');
if (tag === 'latest' || tag === 'main' || tag === 'dev') {
  fail(`--tag must be an immutable release tag; "${tag}" is a floating tag. The deployment must name a release, or "what is prod running?" has no answer.`);
}

const dir = resolve(REPO_ROOT, dirArg);
const files = ['api-deployment.yaml', 'web-deployment.yaml', 'backup-deployment.yaml'];
const changed = [];
for (const name of files) {
  const path = join(dir, name);
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    fail(`could not read ${path} — is --dir the nido kustomization in the ovh-flux repo?`);
  }
  const lines = content.split('\n');
  let touched = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = IMAGE_LINE.exec(lines[i]);
    if (!match) continue;
    lines[i] = `${match[1]}:${tag}${match[2]}`;
    touched += 1;
  }
  if (touched === 0) {
    fail(`no nido image line found in ${name} — the deployment shape changed; update this script's files or pattern.`);
  }
  const next = lines.join('\n');
  if (next !== content) {
    writeFileSync(path, next, 'utf8');
    changed.push(name);
  }
}

if (changed.length === 0) {
  console.log(`update-flux-images: ${dir} is already at ${tag} — nothing to do.`);
  process.exit(0);
}
console.log(`update-flux-images: pinned ${changed.join(', ')} to ${tag}.`);
