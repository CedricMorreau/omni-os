import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootScreenProps } from '../navigation/types';
import { usePairing } from '../pairing/PairingProvider';
import { STATUS_LABEL } from '../pairing/status';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';

export function HomeScreen({ navigation }: RootScreenProps<'Home'>) {
  const { colors } = useOmniTheme();
  const insets = useSafeAreaInsets();
  const { activeServer, statusById, refreshActive } = usePairing();
  const status = activeServer ? statusById[activeServer.id] : undefined;
  const statusLabel = status ? STATUS_LABEL[status] : STATUS_LABEL.checking;

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
        Threads and channels will appear here once the app can load them from your server.
      </Text>

      {activeServer && (
        <View
          accessible
          accessibilityLabel={`${activeServer.name}, ${activeServer.origin}. ${statusLabel}.`}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}
        >
          <Text style={[styles.serverName, { color: colors.fg }]}>{activeServer.name}</Text>
          <Text style={[styles.body, { color: colors.fg3 }]}>{activeServer.origin}</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.dot,
                { backgroundColor: status === 'ready' ? colors.fg : colors.fg4 },
              ]}
            />
            <Text style={[styles.statusLabel, { color: colors.fg }]}>{statusLabel}</Text>
          </View>
        </View>
      )}

      {status === 'unreachable' && (
        <Button label="Retry" variant="secondary" onPress={() => void refreshActive()} />
      )}
      {status === 'incompatible' && (
        <Text style={[styles.body, { color: colors.fg3 }]}>
          This server speaks an API this app doesn&apos;t support. Update the app or the server.
        </Text>
      )}

      <Button label="Servers" onPress={() => navigation.navigate('Servers')} />
      <Button label="Add server" variant="secondary" onPress={() => navigation.navigate('AddServer')} />
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
  serverName: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    marginTop: space.s4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  statusLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
