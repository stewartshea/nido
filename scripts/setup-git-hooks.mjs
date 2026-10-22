#!/usr/bin/env node
//
// Points git at the hooks in .githooks/.
//
// The commit-msg hook there refuses a commit whose message has no
// Signed-off-by trailer. Without this, the hook is just a file in the
// repository that git never runs.
//
// This runs from the `prepare` script, which npm runs after `npm install`,
// so a fresh clone has the hook armed without anyone having to remember to
// do it. It is idempotent and safe to run again.
//
// The hook can also be armed by hand:
//
//   git config core.hooksPath .githooks

import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // Not a git checkout. `npm ci` in a tarball, a Docker build layer, a CI
  // job that did not check the repository out — none of those need hooks,
  // and none of them should fail the install.
}
