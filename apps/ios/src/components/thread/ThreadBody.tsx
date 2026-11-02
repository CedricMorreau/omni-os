import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PendingMsg } from '@omni/client-core';

import type { ThreadLive, ThreadView } from '../../live/hub';
import { useMarkResultRead } from '../../live/react';
import { foldTranscript } from '../../live/transcript';
import { liveMessages } from '../../needs/thread-cards';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../../theme';
import { TranscriptRow } from '../TranscriptRow';
import { NeedsCards } from './NeedsCards';
import type { SendAnswers } from './QuestionCard';
import { useKeyboardInset } from './useKeyboardInset';

/** Within this many points of the newest row, the thread counts as followed. */
const FOLLOW_SLACK = 48;

/** The transcript, newest at the bottom, with the messages the agent has not read yet and paging toward older rows. */
export function ThreadBody({ view, live }: { view: ThreadView; live: ThreadLive | null }) {
  const { colors } = useOmniTheme();
  const rows = view.rows;
  const items = useMemo(() => foldTranscript(rows), [rows]);
  // The list is inverted, so the newest row sits at index 0 and scrolling up reaches older rows.
  const data = useMemo(() => [...items].reverse(), [items]);
  useMarkResultRead(view.threadId, view.thread?.status);
  const { ref, inset } = useKeyboardInset();
  const answer: SendAnswers = (questionId, answers) => (live ? live.answerQuestion(questionId, answers) : Promise.reject(new Error('Still connecting. Try again in a moment.')));
  return (
    <View ref={ref} collapsable={false} style={styles.fill}>
      <FlatList
        inverted
        data={data}
        keyExtractor={(item) => String(item.key)}
        renderItem={({ item }) => <TranscriptRow item={item} onLoadWhole={(eventId) => void live?.loadFullRow(eventId)} onAnswer={answer} />}
        contentContainerStyle={styles.content}
        onScroll={(e) => live?.setFollowing(e.nativeEvent.contentOffset.y < FOLLOW_SLACK)}
        scrollEventThrottle={100}
        onEndReached={() => void live?.loadOlder()}
        onEndReachedThreshold={0.4}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={{ height: inset }} />
            {view.thread && live ? <NeedsCards thread={view.thread} pending={view.pending} blocked={view.blocked !== null} act={(action) => live.act(action)} /> : null}
            <PendingList pending={liveMessages(view.pending)} />
          </View>
        }
        ListFooterComponent={<OlderFooter hasOlder={view.hasOlder} loading={view.loadingOlder} empty={items.length === 0} onLoad={() => void live?.loadOlder()} />}
        ListEmptyComponent={view.status === 'ready' ? <Text style={[styles.meta, { color: colors.fg3 }]}>No messages yet.</Text> : undefined}
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

function pendingLabel(p: PendingMsg): string {
  if (p.kind === 'crew_report') return 'Crew report';
  return p.state === 'held' ? 'Held' : 'Waiting for the agent';
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  meta: {
    fontSize: fontSize.meta,
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
});
