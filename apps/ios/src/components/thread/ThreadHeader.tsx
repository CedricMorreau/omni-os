import { StyleSheet, Text, View } from 'react-native';

import type { ThreadStatus } from '@omni/client-core';

import type { ThreadView } from '../../live/hub';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { StatusLine } from '../StatusLine';

/** Above the transcript: the connection, the thread's status and channel, a failed refresh, and why a turn cannot start here. */
export function ThreadHeader({ view }: { view: ThreadView }) {
  const { colors } = useOmniTheme();
  const statusLine = [threadStatusLabel(view.thread?.status), view.channel?.name].filter(Boolean).join(' · ');
  return (
    <>
      <View style={styles.statusBar}>
        <StatusLine />
        {statusLine ? <Text style={[styles.meta, { color: colors.fg3 }]}>{statusLine}</Text> : null}
        {view.error ? <Text style={[styles.meta, { color: colors.fg3 }]}>{`Last update failed: ${view.error}`}</Text> : null}
      </View>
      {view.blocked ? (
        <View style={[styles.blocked, { borderColor: colors.lineStrong }]}>
          <Text style={[styles.blockedText, { color: colors.fg }]}>{view.blocked}</Text>
        </View>
      ) : null}
    </>
  );
}

function threadStatusLabel(status: ThreadStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'queued':
      return 'Queued';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'imported':
      return 'Imported';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  statusBar: {
    paddingHorizontal: space.s9,
    paddingBottom: space.s4,
    gap: space.s2,
  },
  meta: {
    fontSize: fontSize.meta,
  },
  blocked: {
    marginHorizontal: space.s9,
    marginBottom: space.s4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.s8,
  },
  blockedText: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
