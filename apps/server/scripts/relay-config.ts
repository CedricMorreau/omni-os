// Prints the one-time steps to deploy the sync relay (apps/relay) on your Cloudflare account, with this install's
// Clerk app and linked Google account filled in.
//
//   npm run relay:config
//
// The relay trusts the Clerk app that signs machines in, and only the Clerk users on ALLOWED_USERS. Run it on the
// Omni whose Google account is linked (Settings, Sharing & access); every machine that syncs must use that same Clerk app.
// Omni Connect (docs/adr/0009-omni-connect.md) adds four optional Cloudflare secrets, printed at the end.
import { join } from 'node:path';
import { clerkConfig } from '../clerk.ts';
import { ROOT } from '../config.ts';
import { owner } from '../google-auth.ts';

const clerk = clerkConfig();
const who = owner();
if (!clerk) {
  console.error('Google sign-in is not set up on this Omni: set integrations.clerkClientId (Settings, Sharing & access) first.');
  process.exit(1);
}
if (!who) {
  console.error('No Google account is linked to this Omni yet. Link it in Settings, Sharing & access, then run this again.');
  process.exit(1);
}

const secrets = JSON.stringify({ CLERK_ISSUER: clerk.issuer, CLERK_CLIENT_ID: clerk.clientId, ALLOWED_USERS: who.sub });
/** The zone Omni Connect hostnames go under by default: <name>-<6 hex>.omni-os.app. */
const CONNECT_ZONE = 'omni-os.app';
const connectSecrets = JSON.stringify({ CF_API_TOKEN: '<token>', CF_ACCOUNT_ID: '<account id>', CF_ZONE_ID: '<zone id>', CONNECT_ZONE });
console.log(`Deploy the Omni sync relay to your Cloudflare account. Run these once:

  cd ${join(ROOT, 'apps/relay')}
  npx wrangler login
  npx wrangler r2 bucket create omni-relay
  npx wrangler deploy
  echo '${secrets}' | npx wrangler secret bulk

wrangler deploy prints the relay's URL (https://omni-relay.<account>.workers.dev). Paste it in Settings, Sync,
Sync on each machine and sign in with Google as ${who.email ?? who.sub}.

To let another Clerk user in, or take one out, edit ALLOWED_USERS (comma-separated) with:
  npx wrangler secret put ALLOWED_USERS
Taking a user out signs out every machine of theirs at once. Later updates are \`npx wrangler deploy\` again; the
secrets stay.

Omni Connect (optional, docs/user/omni-connect.md) needs four more secrets. Without them the relay answers 503
connect_not_configured to Connect calls, and sync keeps working.

  CF_API_TOKEN   a Cloudflare API token with Account: Cloudflare Tunnel: Edit, and Zone: DNS: Edit on the zone below
  CF_ACCOUNT_ID  the id of the Cloudflare account that holds the zone
  CF_ZONE_ID     the id of the zone the machine hostnames go under
  CONNECT_ZONE   that zone's name, ${CONNECT_ZONE}

Fill in the first three and run, from the same folder:
  echo '${connectSecrets}' | npx wrangler secret bulk
or set each one with \`npx wrangler secret put <NAME>\`. You can also add them to the JSON above on the first deploy.
The Connect page is <relay URL>/connect.`);
