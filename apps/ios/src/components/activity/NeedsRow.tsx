import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NeedsGlyph, NeedsRow as NeedsRowModel } from '../../live/activity-model';
import { fontSize, lineHeight, minTarget, space, useOmniTheme } from '../../theme';
import { type DotTone, StatusDot } from '../StatusDot';

const TONE: Record<NeedsGlyph, DotTone> = { needs: 'warn', done: 'ok', settled: 'muted' };

/** A Needs you item as phone web's card heads it: where it came from, the thread, then why it is here. Opens the thread. */
export function NeedsRow({ row, onPress }: { row: NeedsRowModel; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const title = row.thread.title || 'Untitled';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, row.label, row.detail, row.meta].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
    >
      <View style={styles.dot}>
        <StatusDot tone={TONE[row.glyph]} />
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
          {row.meta}
        </Text>
        <View style={styles.top}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.fg }]}>
            {title}
          </Text>
          <Text style={[styles.ago, { color: colors.fg3 }]}>{row.ago}</Text>
        </View>
        <Text numberOfLines={4} style={[styles.reason, { color: colors.fg2 }]}>
          <Text style={{ color: colors.fg }}>{row.label}</Text>
          {row.detail ? ` · ${row.detail}` : null}
        </Text>
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
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s4,
  },
  title: {
    flex: 1,
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.heading),
    fontWeight: '500',
  },
  ago: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
  reason: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  meta: {
    fontSize: fontSize.meta,
  },
});
