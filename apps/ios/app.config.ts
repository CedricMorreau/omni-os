import type { ExpoConfig } from 'expo/config';

// expo-camera and expo-image-picker both write NSCameraUsageDescription, so they share one sentence for both uses.
const CAMERA = 'Omni OS uses the camera to scan the pairing code shown on your computer and to take photos you attach to a message.';

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
    ['expo-camera', { cameraPermission: CAMERA }],
    // Photos only: no video, so no microphone.
    ['expo-image-picker', { photosPermission: 'Omni OS reads the photos you pick so you can attach them to a message.', cameraPermission: CAMERA, microphonePermission: false }],
  ],
  experiments: { reactCompiler: true },
};

export default config;
