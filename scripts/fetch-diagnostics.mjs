/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Pulls the most recent entries from the `clientLogs` Firestore collection
// (see src/lib/diagnostics.ts) for remote debugging of device/browser-specific
// issues. Uses the Firestore REST API directly via a service account JWT, so
// no extra dependencies (e.g. firebase-admin) are needed in the project.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/fetch-diagnostics.mjs [limit]

import { readFileSync } from 'fs';
import crypto from 'crypto';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const limit = Number(process.argv[2]) || 50;
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key.');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(credPath, 'utf8'));
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
const claims = Buffer.from(JSON.stringify({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now, exp: now + 3600
})).toString('base64url');
const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key).toString('base64url');

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claims}.${sig}`
});
const { access_token } = await tokenRes.json();
if (!access_token) {
  console.error('Failed to get access token');
  process.exit(1);
}

const dbPath = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const queryRes = await fetch(`https://firestore.googleapis.com/v1/${dbPath}:runQuery`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'clientLogs' }],
      orderBy: [{ field: { fieldPath: 'ts' }, direction: 'DESCENDING' }],
      limit
    }
  })
});

const rows = await queryRes.json();
if (!Array.isArray(rows)) {
  console.error('Unexpected response:', JSON.stringify(rows, null, 2));
  process.exit(1);
}

const toVal = (v) => v?.stringValue ?? v?.booleanValue ?? v?.integerValue ?? v?.timestampValue
  ?? (v?.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, toVal(val)])) : null);

const entries = rows.filter(r => r.document).map(r => {
  const f = r.document.fields;
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, toVal(v)]));
});

if (entries.length === 0) {
  console.log('No diagnostic logs found.');
} else {
  entries.reverse().forEach(d => {
    const uid = d.uid ? d.uid.slice(0, 6) + '…' : 'anon';
    const device = d.device || {};
    console.log(`[${d.ts}] ${d.level?.toUpperCase()} ${d.category} (${uid}) ${device.platform || ''} ${device.standalone ? 'standalone' : ''}`);
    console.log(`  ${d.message}${d.detail ? '\n  detail: ' + d.detail : ''}`);
    if (device.ua) console.log(`  ua: ${device.ua}`);
  });
}
