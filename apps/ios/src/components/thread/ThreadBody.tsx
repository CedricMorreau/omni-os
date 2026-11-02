import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PendingMsg } from '@omni/client-core';

import type { ThreadLive, ThreadView } from '../../live/hub';
import { useMarkResultRead } from '../../live/react';
import { liveMessages } from '../../needs/thread-cards';
import type { RootStackParamList } from '../../navigation/types';
import { CLOSED, type Disclosure, threadRows, type ThreadRow } from '../../thread/rows';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../../theme';
import { NeedsCards } from './NeedsCards';
import type { SendAnswers } from './QuestionCard';
import { type RowActions, RowActionsContext } from './rows/actions';
import { RowView } from './rows/RowView';
import { useKeyboardInset } from './useKeyboardInset';

/** Within this many points of the newest row, the thread counts as followed. */
const FOLLOW_SLACK = 48;

const toggled = <T,>(set: ReadonlySet<T>, v: T): ReadonlySet<T> => {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
};

/** The thread's rows, rebuilt from its events. A row that did not change stays the object it was. */
function useThreadRows(view: ThreadView, disclosure: Disclosure): ThreadRow[] {
  const prev = useRef<readonly ThreadRow[]>([]);
  const { thread } = view;
  const rows = useMemo(() => {
    if (!thread) return [];
    return threadRows(
      {
        events: view.rows,
        spans: view.spans,
        thread,
        artifacts: view.artifacts,
        children: view.children,
        atStart: !view.hasOlder,
        conductor: thread.channel_id === 'conductor',
        disclosure,
      },
      prev.current,
    ).rows;
  }, [thread, view.rows, view.spans, view.artifacts, view.children, view.hasOlder, disclosure]);
  useEffect(() => {
    prev.current = rows;
  }, [rows]);
  return rows;
}

/** The transcript, newest at the bottom, with the messages the agent has not read yet and paging toward older rows. */
export function ThreadBody({ view, live }: { view: ThreadView; live: ThreadLive | null }) {
  const { colors } = useOmniTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [disclosure, setDisclosure] = useState<Disclosure>(CLOSED);
  const rows = useThreadRows(view, disclosure);
  // The list is inverted, so the newest row sits at index 0 and scrolling up reaches older rows.
  const data = useMemo(() => [...rows].reverse(), [rows]);
  useMarkResultRead(view.threadId, view.thread?.status);
  const { ref, inset } = useKeyboardInset();

  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const cwd = view.thread?.cwd ?? null;
  const actions = useMemo<RowActions>(
    () => ({
      openThread: (id) => navigation.push('Thread', { id }),
      loadWhole: (eventId) => void liveRef.current?.loadFullRow(eventId),
      toggleTurn: (turn) => setDisclosure((d) => ({ ...d, turns: toggled(d.turns, turn) })),
      toggleCall: (id) => setDisclosure((d) => ({ ...d, calls: toggled(d.calls, id) })),
      loadOutput: (eventId, offset) => (liveRef.current ? liveRef.current.loadOutput(eventId, offset) : Promise.reject(new Error('Still connecting.'))),
      answer: ((questionId, answers) => (liveRef.current ? liveRef.current.answerQuestion(questionId, answers) : Promise.reject(new Error('Still connecting. Try again in a moment.')))) as SendAnswers,
      cwd,
    }),
    [navigation, cwd],
  );

  const renderItem = useCallback(({ item }: { item: ThreadRow }) => <RowView row={item} />, []);
  return (
    <View ref={ref} collapsable={false} style={styles.fill}>
      <RowActionsContext.Provider value={actions}>
        <FlatList
          inverted
          data={data}
          keyExtractor={rowKey}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          onScroll={(e) => live?.setFollowing(e.nativeEvent.contentOffset.y < FOLLOW_SLACK)}
          scrollEventThrottle={100}
          onEndReached={() => void live?.loadOlder()}
          onEndReachedThreshold={0.4}
          initialNumToRender={14}
          maxToRenderPerBatch={8}
          windowSize={9}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <View style={{ height: inset }} />
              {view.thread && live ? <NeedsCards thread={view.thread} pending={view.pending} blocked={view.blocked !== null} act={(action) => live.act(action)} /> : null}
              <PendingList pending={liveMessages(view.pending)} />
            </View>
          }
          ListFooterComponent={<OlderFooter hasOlder={view.hasOlder} loading={view.loadingOlder} empty={rows.length === 0} onLoad={() => void live?.loadOlder()} />}
          ListEmptyComponent={view.status === 'ready' ? <Text style={[styles.meta, { color: colors.fg3 }]}>No messages yet.</Text> : undefined}
        />
      </RowActionsContext.Provider>
    </View>
  );
}

const rowKey = (row: ThreadRow) => row.key;

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
