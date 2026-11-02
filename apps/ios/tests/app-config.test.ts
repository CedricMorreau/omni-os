import { describe, expect, it } from 'vitest';

import config, { apsEnvironment } from '../app.config';

describe('apsEnvironment', () => {
  it('signs distribution profiles for production APNs and everything else for the sandbox', () => {
    expect(apsEnvironment('production')).toBe('production');
    expect(apsEnvironment('preview')).toBe('production');
    expect(apsEnvironment('development')).toBe('development');
    expect(apsEnvironment('development-simulator')).toBe('development');
    expect(apsEnvironment(undefined)).toBe('development');
  });
});

describe('app config', () => {
  it('adds the notifications plugin that writes the push entitlement', () => {
    const plugin = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-notifications');
    expect(plugin).toBeDefined();
  });

  it('keeps the bundle id the server\'s alerts are addressed to', () => {
    expect(config.ios?.bundleIdentifier).toBe('app.omni-os.ios');
  });
});
