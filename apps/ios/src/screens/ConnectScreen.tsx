import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RootScreenProps } from '../navigation/types';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../theme';

export function ConnectScreen(_props: RootScreenProps<'Connect'>) {
  const { colors } = useOmniTheme();

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View
        accessible
        accessibilityLabel="Placeholder. Not functional yet."
        style={[styles.badge, { backgroundColor: colors.surface2, borderColor: colors.lineStrong }]}
      >
        <Text style={[styles.badgeLabel, { color: colors.fg2 }]}>Placeholder, not functional</Text>
      </View>

      <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
        Connect to a server
      </Text>
      <Text style={[styles.body, { color: colors.fg3 }]}>
        Pairing with your Omni server is not built yet. This screen only shows where it will live.
        Nothing here contacts a server.
      </Text>

      <View
        accessible
        accessibilityLabel="Server address, not available yet"
        accessibilityState={{ disabled: true }}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.line }]}
      >
        <Text style={[styles.fieldLabel, { color: colors.fg3 }]}>Server address</Text>
        <Text style={[styles.fieldValue, { color: colors.fg4 }]}>Available in a later milestone</Text>
      </View>

      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel="Connect, not available yet"
        accessibilityState={{ disabled: true }}
        style={[styles.button, { backgroundColor: colors.surface2 }]}
      >
        <Text style={[styles.buttonLabel, { color: colors.fg3 }]}>Connect</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingTop: space.s9,
    paddingBottom: space.s11,
    gap: space.s8,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s6,
    paddingVertical: space.s2,
  },
  badgeLabel: {
    fontSize: fontSize.meta,
    fontWeight: '600',
  },
  title: {
    fontSize: fontSize.titleLg,
    lineHeight: Math.round(fontSize.titleLg * lineHeight.tight * 1.1),
    fontWeight: '700',
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  field: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s2,
    marginTop: space.s4,
  },
  fieldLabel: {
    fontSize: fontSize.meta,
    fontWeight: '500',
  },
  fieldValue: {
    fontSize: fontSize.input,
  },
  button: {
    minHeight: minTarget,
    borderRadius: radius.pill,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: fontSize.input,
    fontWeight: '600',
  },
});
