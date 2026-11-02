import { StyleSheet, Text } from 'react-native';

import { fontSize, space, useOmniTheme } from '../theme';

/** A section label in a list, such as "Active" or a folder name. */
export function ListHeading({ children }: { children: string }) {
  const { colors } = useOmniTheme();
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.fg3 }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize.meta,
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: space.s9,
    paddingTop: space.s9,
    paddingBottom: space.s4,
  },
});
