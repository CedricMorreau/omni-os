import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootScreenProps } from '../navigation/types';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../theme';

export function HomeScreen({ navigation }: RootScreenProps<'Home'>) {
  const { colors } = useOmniTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s10, paddingBottom: insets.bottom + space.s10 },
      ]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
        Omni
      </Text>
      <Text style={[styles.body, { color: colors.fg3 }]}>
        This is a placeholder home screen. Threads and channels will show up here once the app can
        connect to your Omni server.
      </Text>

      <View
        accessible
        accessibilityLabel="Connection status: not connected. No server paired yet."
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}
      >
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: colors.fg4 }]} />
          <Text style={[styles.statusLabel, { color: colors.fg }]}>Not connected</Text>
        </View>
        <Text style={[styles.cardBody, { color: colors.fg3 }]}>No server paired yet.</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Connect to a server"
        accessibilityHint="Opens the connect screen. It is a placeholder and does not connect yet."
        onPress={() => navigation.navigate('Connect')}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.fg, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: colors.onInk }]}>Connect to a server</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    gap: space.s8,
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
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.s9,
    gap: space.s4,
    marginTop: space.s4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  statusLabel: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  cardBody: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  button: {
    minHeight: minTarget,
    borderRadius: radius.pill,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.s4,
  },
  buttonLabel: {
    fontSize: fontSize.input,
    fontWeight: '600',
  },
});
