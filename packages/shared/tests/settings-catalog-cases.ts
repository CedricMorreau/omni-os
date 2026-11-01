import { LEGACY_SETTINGS_SECTIONS, searchSettings, SETTINGS_ENTRIES, SETTINGS_GROUPS, SETTINGS_SECTION_DEFS, type SettingsSurface } from '../settings-catalog.ts';

/** Searches both ports must answer the same way: ids, best first. */
export const SEARCHES: { query: string; surface: SettingsSurface }[] = [
  { query: 'theme', surface: 'web' },
  { query: 'dark', surface: 'mac' },
  { query: 'limit', surface: 'web' },
  { query: 'model', surface: 'web' },
  { query: 'hotkey', surface: 'web' },
  { query: 'hotkey', surface: 'mac' },
  { query: 'tailscale', surface: 'web' },
  { query: 'worktree clean', surface: 'web' },
  { query: 'port', surface: 'mac' },
  { query: 'Notífy', surface: 'web' },
  { query: '', surface: 'web' },
  { query: 'zzz', surface: 'web' },
];

export const catalogFixture = () => ({
  groups: SETTINGS_GROUPS,
  sections: SETTINGS_SECTION_DEFS,
  entries: SETTINGS_ENTRIES,
  legacy: LEGACY_SETTINGS_SECTIONS,
  searches: SEARCHES.map((s) => ({ ...s, expected: searchSettings(s.query, s.surface).map((e) => e.id) })),
});
