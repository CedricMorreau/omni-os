import { StyleSheet, View } from 'react-native';

import type { ThreadLive } from '../../live/hub';
import { useStore } from '../../live/react';
import { space } from '../../theme';
import { Button } from '../../ui/Button';
import { UserBubble } from '../UserBubble';
import { editInComposer } from './drafts';

/**
 * The message on its way, drawn where it will land in the transcript. When it failed, the text stays here with a
 * Retry (the same request id, so a send that did reach the server is not repeated) and an Edit that moves it back
 * into the composer.
 */
export function OutboxRow({ live, threadId }: { live: ThreadLive; threadId: string }) {
  const item = useStore(live.send.state).outbox.item;
  if (!item) return null;

  if (item.phase === 'sending') return <UserBubble text={item.text} caption="Sending…" busy />;

  const edit = () => {
    const text = live.send.edit();
    if (text !== null) editInComposer(threadId, text);
  };

  return (
    <UserBubble text={item.text} caption={item.failure.message} dimmed>
      <View style={styles.actions}>
        {item.failure.kind === 'signed-out' ? null : (
          <View style={styles.action}>
            <Button label="Retry" onPress={() => void live.send.retry()} />
          </View>
        )}
        <View style={styles.action}>
          <Button label="Edit" variant="secondary" onPress={edit} />
        </View>
      </View>
    </UserBubble>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: space.s4,
    paddingTop: space.s2,
  },
  action: {
    flex: 1,
  },
});
