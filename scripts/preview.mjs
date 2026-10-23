#!/usr/bin/env node
//
// Deploys and tears down the per-PR preview environments.
//
//   node scripts/preview.mjs deploy   --pr 42 --sha <full head sha>
//   node scripts/preview.mjs teardown --pr 42
//
// A preview is a namespace named nido-pr-<number> holding one API Deployment,
// one web Deployment, their Services and an HTTPRoute. It is reached at
// https://pr-<number>.previews.dev.nido-app.ca.
//
// Everything that varies per PR — the namespace, the image tags, the
// hostname — is rendered into deploy/kubernetes/preview/.render/nido-pr-<number>/
// as a kustomize overlay on top of base/. The base itself never changes
// shape, so a preview is always the same two Deployments and the same
// two Services.
//
// The cluster side of this (the wildcard certificate, the ServiceAccount CI
// deploys as, the admission policy that limits that ServiceAccount to
// nido-pr-<number> namespaces) lives in the ovh-flux repository, not here.

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_DIR = join(REPO_ROOT, 'deploy', 'kubernetes', 'preview');
const RENDER_DIR = join(PREVIEW_DIR, '.render');

// The preview zone. One wildcard A record, *.previews.dev.nido-app.ca,
// resolves every preview hostname to the Traefik LoadBalancer, and one
// wildcard certificate covers every one of them. A wildcard matches exactly
// one label, so pr-42.previews.dev.nido-app.ca works and
// a.b.previews.dev.nido-app.ca does not — a PR number is the only thing
// that ever goes in a preview hostname.
const HOST_SUFFIX = 'previews.dev.nido-app.ca';

const IMAGE_REPO = 'ghcr.io/stewartshea/nido';

function fail(message) {
  console.error(`\npreview: ${message}\n`);
  process.exit(1);
}

function run(command, args, { input } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const detail = (stderr || stdout).trim();
      rejectPromise(new Error(`${command} ${args.join(' ')} exited ${code}\n${detail}`));
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

async function kubectl(args, options) {
  try {
    return await run('kubectl', args, options);
  } catch (error) {
    console.error(error.message);
    throw error;
  }
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

function previewNamespace(pr) {
  return `nido-pr-${pr}`;
}

function previewHostname(pr) {
  return `pr-${pr}.${HOST_SUFFIX}`;
}

// The master key and the JWT secret are derived, not random.
//
// A preview's data lives on an emptyDir, so it is destroyed whenever the
// pod is replaced. The key has to change at exactly the same moment the
// pod does, otherwise a redeploy leaves a pod holding a key that no longer
// matches the Secret, and the next pod restart cannot decrypt anything.
// Deriving the key from the PR number and the commit gives that for free:
// the key changes when the image tag changes, which is exactly when the pod
// is replaced, and a redeploy of the same commit keeps the same key.
//
// The salt keeps the derived key out of reach of anyone who can guess the
// PR number and read the commit history.
function deriveKey(salt, label, pr, sha) {
  return createHmac('sha256', salt).update(`${label}:nido-pr-${pr}:${sha}`).digest('hex');
}

function namespaceManifest(pr) {
  return [
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    `  name: ${previewNamespace(pr)}`,
    '  labels:',
    // The label the cluster-side sweeper looks for, and the label the
    // admission policy requires on a namespace this deployer creates.
    '    nido-app.ca/preview: "true"',
    '',
  ].join('\n');
}

function secretManifest(pr, masterKey, jwtSecret) {
  return [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: preview-secrets',
    `  namespace: ${previewNamespace(pr)}`,
    '  labels:',
    '    app: nido-preview',
    'type: Opaque',
    'data:',
    `  NIDO_MASTER_KEY: ${Buffer.from(masterKey, 'utf8').toString('base64')}`,
    `  JWT_SECRET: ${Buffer.from(jwtSecret, 'utf8').toString('base64')}`,
    '',
  ].join('\n');
}

function kustomization(pr, sha) {
  const host = previewHostname(pr);
  const tag = `sha-${sha.slice(0, 12)}`;
  return [
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    '',
    `# Rendered by scripts/preview.mjs for pull request #${pr}. Not committed.`,
    '',
    `namespace: ${previewNamespace(pr)}`,
    '',
    'resources:',
    '  - ../../base',
    '  - namespace.yaml',
    '',
    'images:',
    `  - name: ${IMAGE_REPO}/api`,
    `    newTag: ${tag}`,
    `  - name: ${IMAGE_REPO}/web`,
    `    newTag: ${tag}`,
    '',
    'patches:',
    '  - target:',
    '      kind: ConfigMap',
    '      name: preview-config',
    '    patch: |-',
    '      - op: replace',
    '        path: /data/HOSTNAME',
    `        value: ${host}`,
    '      - op: replace',
    '        path: /data/PUBLIC_URL',
    `        value: https://${host}`,
    '  - target:',
    '      kind: HTTPRoute',
    '      name: nido-preview',
    '    patch: |-',
    '      - op: replace',
    '        path: /spec/hostnames/0',
    `        value: ${host}`,
    '',
  ].join('\n');
}

async function render(pr, sha) {
  const dir = join(RENDER_DIR, `nido-pr-${pr}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'kustomization.yaml'), kustomization(pr, sha), 'utf8');
  await writeFile(join(dir, 'namespace.yaml'), namespaceManifest(pr), 'utf8');
  return dir;
}

async function waitForRollout(pr, deployment) {
  const args = [
    '-n',
    previewNamespace(pr),
    'rollout',
    'status',
    `deployment/${deployment}`,
    '--timeout=180s',
  ];
  try {
    const { stdout } = await kubectl(args);
    console.log(stdout.trim());
  } catch {
    // The rollout failed. Show why, because "timed out waiting for the
    // condition" on its own is useless in a CI log.
    const { stdout } = await kubectl([
      '-n',
      previewNamespace(pr),
      'get',
      'pods',
      '-o',
      'wide',
    ]);
    console.error(stdout);
    const describe = await kubectl([
      '-n',
      previewNamespace(pr),
      'describe',
      `deployment/${deployment}`,
    ]).catch((error) => ({ stdout: error.message }));
    console.error(describe.stdout);
    throw new Error(`deployment/${deployment} did not become ready`);
  }
}

// Fill the preview's empty database with the same fixed test family the local
// and CI environments use.
//
// A preview starts from nothing, so without this the credentials in the README
// are a 401 on a preview and a reviewer has no data to exercise. The script is
// compiled into the image (api/src/scripts/) and reads the pod's own
// NIDO_MASTER_KEY and NIDO_DATA_DIR, so it writes the same database the running
// API serves.
//
// Best effort on purpose: a preview with no fixtures is still a working
// preview, and failing the deploy over seed data would take the URL away too.
async function seed(pr) {
  try {
    const { stdout } = await kubectl([
      '-n',
      previewNamespace(pr),
      'exec',
      'deployment/nido-preview-api',
      '--',
      'node',
      'dist/scripts/seed-test-data.js',
    ]);
    console.log(stdout.trim());
  } catch (error) {
    console.warn(`preview: seeding failed — the preview is up but has no test data\n${error.message}`);
  }
}

async function deploy(args) {
  const pr = args.pr;
  const sha = args.sha;
  if (!pr || !sha) {
    fail('deploy needs --pr <number> and --sha <full head sha>');
  }
  if (!/^[0-9]+$/.test(String(pr))) {
    fail(`--pr must be a pull request number, got ${pr}`);
  }
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) {
    fail(`--sha must be a commit sha, got ${sha}`);
  }

  const salt = process.env.PREVIEW_KEY_SALT;
  if (!salt) {
    fail(
      'PREVIEW_KEY_SALT is not set. It is the salt the preview master key and\n' +
        'JWT secret are derived from, and it is stored as a repository secret.',
    );
  }

  const masterKey = deriveKey(salt, 'master-key', pr, sha);
  const jwtSecret = deriveKey(salt, 'jwt-secret', pr, sha);

  const dir = await render(pr, sha);
  console.log(`preview: rendering ${dir}`);

  // The namespace first: the Secret and everything else lives inside it.
  await kubectl(['apply', '-f', '-'], { input: namespaceManifest(pr) });
  await kubectl(['apply', '-f', '-'], { input: secretManifest(pr, masterKey, jwtSecret) });
  await kubectl(['apply', '-k', dir]);

  await waitForRollout(pr, 'nido-preview-api');
  await waitForRollout(pr, 'nido-preview-web');
  await seed(pr);

  const url = `https://${previewHostname(pr)}`;
  console.log(`\npreview: ${url}`);
  // The workflow reads this to put the URL in the PR comment.
  console.log(`PREVIEW_URL=${url}`);
}

async function teardown(args) {
  const pr = args.pr;
  if (!pr) {
    fail('teardown needs --pr <number>');
  }
  const ns = previewNamespace(pr);
  console.log(`preview: deleting namespace ${ns}`);
  // --wait=false: the namespace takes a while to terminate, and the CI job
  // has nothing to do once the delete is accepted.
  await kubectl(['delete', 'namespace', ns, '--wait=false', '--ignore-not-found=true']);
  console.log(`preview: ${ns} deleted`);
}

// The state of a pull request, as GitHub sees it. 'missing' means there is
// no such pull request any more.
async function pullRequestState(pr, { token, repository }) {
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${pr}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'nido-preview-sweeper',
    },
  });
  if (response.status === 404) return 'missing';
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for pull request #${pr}`);
  }
  const data = await response.json();
  return data.state;
}

// Deletes previews whose pull request is no longer open.
//
// The teardown on `pull_request: closed` is the normal path. This is the
// backstop for the times it does not run: a workflow disabled partway
// through a release, a failed run, a renamed repository, a pull request
// closed while the runner was down. A preview left behind holds roughly
// 130Mi of the node's memory requests on a single node that is already at
// 98% of capacity, and it would degrade the live instances to pay for it.
async function sweep() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    fail('sweep needs GITHUB_TOKEN and GITHUB_REPOSITORY in the environment');
  }

  const { stdout } = await kubectl([
    'get',
    'namespaces',
    '-l',
    'nido-app.ca/preview=true',
    '-o',
    'jsonpath={.items[*].metadata.name}',
  ]);
  const namespaces = stdout.trim().split(/\s+/).filter(Boolean);
  console.log(`preview: ${namespaces.length} preview namespace(s) found`);

  for (const ns of namespaces) {
    const match = /^nido-pr-([0-9]+)$/.exec(ns);
    if (!match) {
      // The shared nido-preview namespace carries the same label. It is
      // infrastructure, not a preview, and deleting it would take the
      // wildcard certificate with it.
      console.log(`preview: ${ns} is not a per-PR namespace, leaving it alone`);
      continue;
    }
    let state;
    try {
      state = await pullRequestState(match[1], { token, repository });
    } catch (error) {
      // A GitHub outage must not turn into a sweep of live previews. Skip
      // this one and try again on the next run.
      console.warn(`preview: could not check pull request #${match[1]}: ${error.message}`);
      continue;
    }
    if (state === 'open') {
      console.log(`preview: ${ns} belongs to an open pull request, keeping it`);
      continue;
    }
    console.log(`preview: ${ns} belongs to a ${state} pull request, deleting it`);
    await kubectl(['delete', 'namespace', ns, '--wait=false', '--ignore-not-found=true']);
  }
}

async function renderOnly(args) {
  const pr = args.pr;
  const sha = args.sha;
  if (!pr || !sha) {
    fail('render needs --pr <number> and --sha <full head sha>');
  }
  const dir = await render(pr, sha);
  console.log(dir);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === 'deploy') {
    await deploy(args);
  } else if (command === 'teardown') {
    await teardown(args);
  } else if (command === 'sweep') {
    await sweep();
  } else if (command === 'render') {
    // Renders the overlay and stops. Used to check the manifests build
    // without a cluster.
    await renderOnly(args);
  } else {
    fail('usage: preview.mjs <deploy|teardown|sweep|render> [--pr <number>] [--sha <sha>]');
  }
}

main().catch((error) => {
  console.error(`\npreview: ${error.message}\n`);
  process.exit(1);
});
