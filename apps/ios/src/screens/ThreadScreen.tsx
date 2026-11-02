import { useEffect, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PendingMsg, ThreadStatus } from '@omni/client-core';

import { useThreadLive, useThreadView } from '../live/react';
import { foldTranscript } from '../live/transcript';
import { StatusLine } from '../components/StatusLine';
import { TranscriptRow } from '../components/TranscriptRow';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../theme';

/** Within this many points of the newest row, the thread counts as followed. */
const FOLLOW_SLACK = 48;

export function ThreadScreen({ route, navigation }: RootScreenProps<'Thread'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);

  const rows = view?.rows;
  const items = useMemo(() => foldTranscript(rows ?? []), [rows]);
  // The list is inverted, so the newest row sits at index 0 and scrolling up reaches older rows.
  const data = useMemo(() => [...items].reverse(), [items]);

  const title = view?.thread?.title || 'Thread';
  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  if (!view || view.status === 'loading') {
    return <Notice title="Loading thread" colors={colors} />;
  }
  if (view.status === 'missing') {
    return <Notice title="Thread not found" body="It may have been archived or removed on the server." colors={colors} />;
  }
  if (view.status === 'error' && !view.thread) {
    return (
      <Notice
        title="Could not open this thread"
        body={view.error ?? undefined}
        colors={colors}
        action={{ label: 'Try again', onPress: () => live?.retry() }}
      />
    );
  }

  const statusLine = [threadStatusLabel(view.thread?.status), view.channel?.name].filter(Boolean).join(' · ');

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
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
      <FlatList
        inverted
        data={data}
        keyExtractor={(item) => String(item.key)}
        renderItem={({ item }) => (
          <TranscriptRow item={item} onLoadWhole={(eventId) => void live?.loadFullRow(eventId)} />
        )}
        contentContainerStyle={styles.content}
        onScroll={(e) => live?.setFollowing(e.nativeEvent.contentOffset.y < FOLLOW_SLACK)}
        scrollEventThrottle={100}
        onEndReached={() => void live?.loadOlder()}
        onEndReachedThreshold={0.4}
        keyboardDismissMode="interactive"
        ListHeaderComponent={<PendingList pending={view.pending} />}
        ListFooterComponent={<OlderFooter hasOlder={view.hasOlder} loading={view.loadingOlder} empty={items.length === 0} onLoad={() => void live?.loadOlder()} />}
        ListEmptyComponent={
          view.status === 'ready' ? <Text style={[styles.meta, { color: colors.fg3 }]}>No messages yet.</Text> : undefined
        }
      />
    </View>
  );
}

function PendingList({ pending }: { pending: PendingMsg[] }) {
  const { colors } = useOmniTheme();
  if (pending.length === 0) return null;
  return (
    <View style={styles.pending}>
      {pending.map((p) => (
        <View key={p.uuid} style={[styles.pendingItem, { backgroundColor: colors.surface }]}>
          <Text style={[styles.meta, { color: colors.fg3 }]}>{pendingLabel(p)}</Text>
          <Text numberOfLines={3} style={[styles.pendingText, { color: colors.fg2 }]}>
            {p.text}
          </Text>
        </View>
      ))}
    </View>
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

function Notice({
  title,
  body,
  colors,
  action,
}: {
  title: string;
  body?: string;
  colors: ReturnType<typeof useOmniTheme>['colors'];
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={[styles.notice, { backgroundColor: colors.bg }]}>
      <Text style={[styles.noticeTitle, { color: colors.fg }]}>{title}</Text>
      {body ? <Text style={[styles.noticeBody, { color: colors.fg3 }]}>{body}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <Text style={[styles.olderLabel, { color: colors.fg }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
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

function pendingLabel(p: PendingMsg): string {
  if (p.kind === 'crew_report') return 'Crew report';
  return p.state === 'held' ? 'Held' : 'Waiting for the agent';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
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
  content: {
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
    gap: space.s8,
  },
  pending: {
    gap: space.s4,
    paddingBottom: space.s6,
  },
  pendingItem: {
    borderRadius: radius.md,
    padding: space.s6,
    gap: space.s2,
  },
  pendingText: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
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
  notice: {
    flex: 1,
    paddingHorizontal: space.s9,
    paddingTop: space.s11,
    gap: space.s4,
  },
  noticeTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  noticeBody: {
    fontSize: fontSize.body,
  },
  action: {
    minHeight: minTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
