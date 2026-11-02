import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ThreadLive, ThreadView } from '../../live/hub';
import { foldTranscript } from '../../live/transcript';
import { fontSize, minTarget, space, useOmniTheme } from '../../theme';
import { TranscriptRow } from '../TranscriptRow';
import { PendingRows } from './PendingRows';

/** Within this many points of the newest row, the thread counts as followed. */
const FOLLOW_SLACK = 48;

/** The transcript, newest at the bottom, with the messages the agent has not read yet and paging toward older rows. */
export function ThreadBody({ view, live }: { view: ThreadView; live: ThreadLive | null }) {
  const { colors } = useOmniTheme();
  const rows = view.rows;
  const items = useMemo(() => foldTranscript(rows), [rows]);
  // The list is inverted, so the newest row sits at index 0 and scrolling up reaches older rows.
  const data = useMemo(() => [...items].reverse(), [items]);
  return (
    <FlatList
      inverted
      data={data}
      keyExtractor={(item) => String(item.key)}
      renderItem={({ item }) => <TranscriptRow item={item} threadId={view.threadId} onLoadWhole={(eventId) => void live?.loadFullRow(eventId)} />}
      contentContainerStyle={styles.content}
      onScroll={(e) => live?.setFollowing(e.nativeEvent.contentOffset.y < FOLLOW_SLACK)}
      scrollEventThrottle={100}
      onEndReached={() => void live?.loadOlder()}
      onEndReachedThreshold={0.4}
      keyboardDismissMode="interactive"
      ListHeaderComponent={live ? <PendingRows view={view} live={live} /> : undefined}
      ListFooterComponent={<OlderFooter hasOlder={view.hasOlder} loading={view.loadingOlder} empty={items.length === 0} onLoad={() => void live?.loadOlder()} />}
      ListEmptyComponent={view.status === 'ready' ? <Text style={[styles.meta, { color: colors.fg3 }]}>No messages yet.</Text> : undefined}
    />
  );
}

function OlderFooter({ hasOlder, loading, empty, onLoad }: { hasOlder: boolean; loading: boolean; empty: boolean; onLoad: () => void }) {
  const { colors } = useOmniTheme();
  if (empty) return null;
  if (loading) {
    return (
      <View style={styles.olderRow}>
        <ActivityIndicator color={colors.fg3} />
      </View>
    );
  }
  if (!hasOlder) {
    return (
      <View style={styles.olderRow}>
        <Text style={[styles.meta, { color: colors.fg3 }]}>Start of thread</Text>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" onPress={onLoad} style={styles.olderRow}>
      <Text style={[styles.olderLabel, { color: colors.fg }]}>Load older messages</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  meta: {
    fontSize: fontSize.meta,
  },
  content: {
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
    gap: space.s8,
  },
  olderRow: {
    minHeight: minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.s4,
  },
  olderLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
