import type { ExpoConfig } from 'expo/config';

/**
 * The APNs environment the build's `aps-environment` entitlement names. Only the development-client profiles talk to
 * Apple's sandbox. An internal-distribution (`preview`) or store build is signed for production, and the app registers
 * its token under the same name (`pushEnvironment` in src/notifications/environment.ts).
 */
export function apsEnvironment(easProfile: string | undefined): 'development' | 'production' {
  return easProfile === 'production' || easProfile === 'preview' ? 'production' : 'development';
}

const config: ExpoConfig = {
  name: 'Omni OS',
  slug: 'omni-os-ios',
  version: '0.1.0',
  scheme: 'omni-os',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'app.omni-os.ios',
    supportsTablet: true,
    infoPlist: {
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  plugins: [
    'expo-dev-client',
    ['expo-build-properties', { ios: { deploymentTarget: '18.0' } }],
    [
      'expo-camera',
      {
        cameraPermission: 'Omni OS uses the camera to scan the pairing code shown on your computer.',
      },
    ],
    ['expo-notifications', { mode: apsEnvironment(process.env.EAS_BUILD_PROFILE) }],
    ['expo-image-picker', { photosPermission: 'Omni OS reads the photos you pick so you can attach them to a message.' }],
  ],
  experiments: { reactCompiler: true },
};

export default config;
