// Prints the one-time steps to deploy the sync relay (apps/relay) on your Cloudflare account, with this install's
// Clerk app and linked Google account filled in.
//
//   npm run relay:config
//
// The relay trusts the Clerk app that signs machines in, and only the Clerk users on ALLOWED_USERS. Run it on the
// Omni whose Google account is linked (Settings, Machines); every machine that syncs must use that same Clerk app.
import { join } from 'node:path';
import { clerkConfig } from '../clerk.ts';
import { ROOT } from '../config.ts';
import { owner } from '../google-auth.ts';

const clerk = clerkConfig();
const who = owner();
if (!clerk) {
  console.error('Google sign-in is not set up on this Omni: set integrations.clerkClientId (Settings, Machines) first.');
  process.exit(1);
}
if (!who) {
  console.error('No Google account is linked to this Omni yet. Link it in Settings, Machines, then run this again.');
  process.exit(1);
}

const secrets = JSON.stringify({ CLERK_ISSUER: clerk.issuer, CLERK_CLIENT_ID: clerk.clientId, ALLOWED_USERS: who.sub });
console.log(`Deploy the Omni sync relay to your Cloudflare account. Run these once:

  cd ${join(ROOT, 'apps/relay')}
  npx wrangler login
  npx wrangler r2 bucket create omni-relay
  npx wrangler deploy
  echo '${secrets}' | npx wrangler secret bulk

wrangler deploy prints the relay's URL (https://omni-relay.<account>.workers.dev). Paste it in Settings, Machines,
Sync on each machine and sign in with Google as ${who.email ?? who.sub}.

To let another Clerk user in, or take one out, edit ALLOWED_USERS (comma-separated) with:
  npx wrangler secret put ALLOWED_USERS
Taking a user out signs out every machine of theirs at once. Later updates are \`npx wrangler deploy\` again; the
secrets stay.`);
