import { Pressable, StyleSheet, Text } from 'react-native';

import { fontSize, minTarget, useOmniTheme } from '../theme';

/** A text button for a navigation header. */
export function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.button}>
      <Text style={[styles.label, { color: colors.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.input,
    fontWeight: '500',
  },
});
