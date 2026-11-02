import { StyleSheet, Text, View } from 'react-native';

import type { PendingMsg } from '@omni/client-core';

import { AttachmentRow } from '../../attachments/AttachmentRow';
import type { ThreadLive, ThreadView } from '../../live/hub';
import { useStore } from '../../live/react';
import { canSendAgain, isParked, pendingLabel, recoveredCount } from '../../send/rules';
import { RESUME_ALL } from '../../send/sender';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { OutboxRow } from './OutboxRow';

/**
 * Everything below the last transcript row: the messages the agent has not read yet, then the one this phone is
 * sending. The newest sits nearest the composer.
 */
export function PendingRows({ view, live }: { view: ThreadView; live: ThreadLive }) {
  const hasOutbox = useStore(live.send.state).outbox.item !== null;
  if (view.pending.length === 0 && !hasOutbox) return null;
  const blocked = !!view.thread?.resume_blocked;
  return (
    <View style={styles.rows}>
      <ResumeAll count={recoveredCount(view.pending)} live={live} />
      {view.pending.map((m) => (
        <PendingRow key={m.uuid} message={m} threadId={view.threadId} blocked={blocked} live={live} />
      ))}
      <OutboxRow live={live} threadId={view.threadId} />
    </View>
  );
}

function PendingRow({ message, threadId, blocked, live }: { message: PendingMsg; threadId: string; blocked: boolean; live: ThreadLive }) {
  const { colors } = useOmniTheme();
  const quiet = message.kind === 'crew_report';
  return (
    <View style={[styles.item, { backgroundColor: colors.surface }]}>
      <Text style={[styles.meta, { color: colors.fg3 }]}>{pendingLabel(message, blocked)}</Text>
      <Text numberOfLines={3} style={[styles.text, { color: quiet ? colors.fg3 : colors.fg2 }]}>
        {message.text}
      </Text>
      <AttachmentRow threadId={threadId} items={message.attachments ?? []} />
      {isParked(message) ? <HeldActions uuid={message.uuid} again={canSendAgain(message)} live={live} /> : null}
    </View>
  );
}

/** Messages held after a restart that never reached the agent go together, in the order they arrived, as on the web. */
function ResumeAll({ count, live }: { count: number; live: ThreadLive }) {
  const running = useStore(live.send.state).heldBusy;
  if (count === 0) return null;
  return (
    <Button label={count > 1 ? `Resume ${count}` : 'Resume'} busy={running === RESUME_ALL} disabled={running !== null && running !== RESUME_ALL} onPress={() => void live.send.resume()} />
  );
}

/**
 * A message held after a restart waits on Ben. An uncertain one may already have reached the agent, so it offers Send
 * again; a recovered one is sent by Resume. Either can be let go. One action runs at a time.
 */
function HeldActions({ uuid, again: canAgain, live }: { uuid: string; again: boolean; live: ThreadLive }) {
  const running = useStore(live.send.state).heldBusy;
  const again = `again:${uuid}`;
  const discard = `discard:${uuid}`;
  return (
    <View style={styles.actions}>
      {canAgain ? (
        <View style={styles.action}>
          <Button label="Send again" busy={running === again} disabled={running !== null && running !== again} onPress={() => void live.send.resume(uuid)} />
        </View>
      ) : null}
      <View style={styles.action}>
        <Button label="Discard" variant="secondary" busy={running === discard} disabled={running !== null && running !== discard} onPress={() => void live.send.discard(uuid)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space.s4,
    paddingBottom: space.s6,
  },
  item: {
    borderRadius: radius.md,
    padding: space.s6,
    gap: space.s2,
  },
  meta: {
    fontSize: fontSize.meta,
  },
  text: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  actions: {
    flexDirection: 'row',
    gap: space.s4,
    paddingTop: space.s4,
  },
  action: {
    flex: 1,
  },
});
