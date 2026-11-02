import { devSession } from './dev-session';
import { UNPAIRED, type OmniSession } from './session';

/**
 * The session the app runs with. The pairing flow replaces this one file with the paired session store. Until then
 * the only session is the dev-only one from the build's environment, and an unpaired device shows no server data.
 */
export const appSession: OmniSession =
  devSession({ url: process.env.EXPO_PUBLIC_OMNI_DEV_URL, token: process.env.EXPO_PUBLIC_OMNI_DEV_TOKEN }, __DEV__) ?? UNPAIRED;
