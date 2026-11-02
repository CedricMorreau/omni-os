import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../theme';

/** A rounded card of rows with a hairline between them. Settings screens are made of these. */
export function GroupedList({ children }: { children: ReactNode }) {
  const { colors } = useOmniTheme();
  return <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.line }]}>{children}</View>;
}

export interface ListRowProps {
  title: string;
  /** A second line under the title. */
  detail?: string;
  /** Text at the trailing edge, such as a count or a state. */
  value?: string;
  /** Replaces the value at the trailing edge, such as a switch. */
  trailing?: ReactNode;
  /** Draws a chevron after the value. */
  chevron?: boolean;
  tone?: 'default' | 'destructive';
  /** Without it the row is plain text. */
  onPress?: () => void;
  disabled?: boolean;
  /** The first row of a group has no line above it. */
  first?: boolean;
  accessibilityHint?: string;
}

export function ListRow({ title, detail, value, trailing, chevron, tone = 'default', onPress, disabled, first, accessibilityHint }: ListRowProps) {
  const { colors } = useOmniTheme();
  const body = (
    <>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.fg, opacity: disabled ? 0.5 : 1 }, tone === 'destructive' && styles.destructive]}>
          {title}
        </Text>
        {detail ? <Text style={[styles.detail, { color: colors.fg3 }]}>{detail}</Text> : null}
      </View>
      {trailing ?? (value ? <Text style={[styles.value, { color: colors.fg3 }]}>{value}</Text> : null)}
      {chevron ? <Text style={[styles.chevron, { color: colors.fg4 }]}>›</Text> : null}
    </>
  );
  const frame = [styles.row, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }];
  if (!onPress) return <View style={frame}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, value, detail].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [frame, pressed && { backgroundColor: colors.surface2 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
  },
  text: {
    flex: 1,
    gap: space.s2 / 2,
  },
  title: {
    fontSize: fontSize.input,
  },
  destructive: {
    fontWeight: '600',
  },
  detail: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  value: {
    fontSize: fontSize.body,
  },
  chevron: {
    fontSize: fontSize.titleLg - 8,
    lineHeight: fontSize.titleLg - 6,
  },
});
