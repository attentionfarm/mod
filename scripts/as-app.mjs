#!/usr/bin/env node
// Act on this repository as the attentionfarm GitHub App, so pushes and
// workflow runs are attributed to the app rather than a personal account.
//
//   node scripts/as-app.mjs configure                commit as the app in this clone
//   node scripts/as-app.mjs push                     push HEAD to main as the app
//   node scripts/as-app.mjs dispatch [--clean-history]   run the publish workflow
//
// Needs ATTENTIONFARM_APP_ID and ATTENTIONFARM_APP_KEY (path to the app's
// private key). The key never leaves this machine; tokens live for an hour.
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const repo = 'attentionfarm/mod';
const appId = process.env.ATTENTIONFARM_APP_ID;
const keyPath = process.env.ATTENTIONFARM_APP_KEY;
if (!appId || !keyPath) {
  console.error('set ATTENTIONFARM_APP_ID and ATTENTIONFARM_APP_KEY (path to the private key)');
  process.exit(1);
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(readFileSync(keyPath), 'base64url')}`;

async function api(path, token, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      ...(token && { authorization: `Bearer ${token}` }),
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function identity() {
  const { slug } = await api('/app', jwt);
  const bot = `${slug}[bot]`;
  const { id } = await api(`/users/${encodeURIComponent(bot)}`);
  return { name: bot, email: `${id}+${bot}@users.noreply.github.com` };
}

async function installationToken() {
  const { id } = await api(`/repos/${repo}/installation`, jwt);
  return (await api(`/app/installations/${id}/access_tokens`, jwt, { method: 'POST' })).token;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const [command, ...flags] = process.argv.slice(2);

if (command === 'configure') {
  const { name, email } = await identity();
  git('config', 'user.name', name);
  git('config', 'user.email', email);
  console.log(`this clone now commits as ${name} <${email}>`);
} else if (command === 'push') {
  const { email } = await identity();
  // Earlier history was published by github-actions[bot]; both bots are fine.
  const allowed = new Set([email, '41898282+github-actions[bot]@users.noreply.github.com']);
  // An empty repository has no main yet; then every commit is outgoing.
  const remoteMain = git('ls-remote', `https://github.com/${repo}.git`, 'refs/heads/main') ? 'origin/main' : null;
  if (remoteMain) git('fetch', '--quiet', 'origin', 'main');
  // Refuse to publish any commit that would carry another identity.
  const range = remoteMain ? `${remoteMain}..HEAD` : 'HEAD';
  const outgoing = git('log', '--format=%H %ae %ce', range).split('\n').filter(Boolean);
  const foreign = outgoing.filter((line) => line.split(' ').slice(1).some((e) => !allowed.has(e)));
  if (foreign.length) {
    console.error(`refusing to push commits not authored and committed by a bot:\n${foreign.join('\n')}`);
    process.exit(1);
  }
  if (!outgoing.length) {
    console.log('nothing to push');
    process.exit(0);
  }
  const token = await installationToken();
  execFileSync('git', ['push', `https://x-access-token:${token}@github.com/${repo}.git`, 'HEAD:main'], { stdio: 'inherit' });
} else if (command === 'dispatch') {
  const cleanHistory = flags.includes('--clean-history');
  await api(`/repos/${repo}/dispatches`, await installationToken(), {
    method: 'POST',
    body: JSON.stringify({ event_type: 'publish', client_payload: { clean_history: cleanHistory } }),
  });
  console.log(`dispatched publish (clean_history=${cleanHistory}) as the app`);
} else {
  console.error('usage: node scripts/as-app.mjs configure | push | dispatch [--clean-history]');
  process.exit(1);
}
