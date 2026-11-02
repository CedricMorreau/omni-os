import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ThreadRow } from '../live/channel-model';
import { fontSize, lineHeight, minTarget, space, useOmniTheme } from '../theme';
import { type DotTone, StatusDot } from './StatusDot';

/** A thread in a list: its state dot, title, and the state word and age on a second line. */
export function ThreadRowView({ row, onPress }: { row: ThreadRow; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const tone: DotTone = row.status === 'failed' ? 'warn' : row.busy ? 'ok' : 'muted';
  const meta = [row.statusLabel, row.ago].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.statusLabel ? `${row.title}, ${row.statusLabel}` : row.title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
    >
      <View style={styles.dot}>
        <StatusDot tone={tone} />
      </View>
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.fg }]}>
          {row.title}
        </Text>
        {meta ? <Text style={[styles.meta, { color: colors.fg3 }]}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s6,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
  },
  dot: {
    paddingTop: 5,
  },
  body: {
    flex: 1,
    gap: space.s2,
  },
  title: {
    fontSize: fontSize.body + 1,
    lineHeight: Math.round((fontSize.body + 1) * lineHeight.body),
    fontWeight: '500',
  },
  meta: {
    fontSize: fontSize.meta,
  },
});
