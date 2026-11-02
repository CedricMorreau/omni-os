import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '../../theme';

/** Below the transcript. The composer goes here; with nothing to show it takes no room. */
export function ThreadFooter({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <View style={styles.footer}>{children}</View>;
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: space.s9,
    paddingVertical: space.s4,
  },
});
