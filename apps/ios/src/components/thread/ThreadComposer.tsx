import { useRef, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { HarnessInfo, Thread } from '@omni/client-core';

import type { ThreadLive } from '../../live/hub';
import { useStore } from '../../live/react';
import { canStop, composerPlaceholder, sendLabel } from '../../send/rules';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { restoreDraft, setDraft, useDraft, useFocusRequests } from './drafts';
import { NextTurnChip } from './RunChips';

const INPUT_LINE_HEIGHT = Math.round(fontSize.input * lineHeight.body);
const MAX_LINES = 6;
const BUTTON_SIZE = 36;
/** One line of text centered in a row as tall as the button. */
const INPUT_PADDING = (BUTTON_SIZE - INPUT_LINE_HEIGHT) / 2;

/**
 * The box a message is written in. It steers or queues while a turn runs (the placeholder and the button's label say
 * which), and swaps Send for Stop when the box is empty and a turn can be stopped. The draft is per thread and
 * outlives the screen.
 */
export function ThreadComposer({
  live,
  thread,
  harnesses,
  onOpenRun,
}: {
  live: ThreadLive;
  thread: Thread;
  /** From `/harnesses`; null until it loads. */
  harnesses: HarnessInfo[] | null;
  onOpenRun: () => void;
}) {
  const { colors } = useOmniTheme();
  const catalog = useStore(live.catalog);
  const { outbox, stopping, notice } = useStore(live.send.state);
  const draft = useDraft(thread.id);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusRequests(thread.id, input);

  const placeholder = composerPlaceholder(thread, catalog);
  const empty = draft.trim() === '';
  const slotTaken = outbox.item !== null;
  const showStop = empty && !slotTaken && canStop(thread);

  const send = async () => {
    if (empty || slotTaken) return;
    const text = draft;
    setDraft(thread.id, '');
    const sent = await live.send.submit(thread, text);
    // A failed send keeps its text in the outbox. Nothing in the slot and nothing sent means it never started.
    if (!sent && live.send.state.get().outbox.item === null) restoreDraft(thread.id, text);
  };

  return (
    <View style={styles.composer}>
      <View style={styles.nextTurn}>
        <NextTurnChip thread={thread} harnesses={harnesses} onPress={onOpenRun} />
      </View>
      {notice ? (
        <Text accessibilityRole="alert" style={[styles.notice, { color: colors.fg2 }]}>
          {notice}
        </Text>
      ) : null}
      <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <TextInput
          ref={input}
          accessibilityLabel={placeholder}
          multiline
          value={draft}
          onChangeText={(text) => setDraft(thread.id, text)}
          placeholder={placeholder}
          placeholderTextColor={colors.fg3}
          style={[styles.input, { color: colors.fg }]}
        />
        {showStop ? (
          <RoundButton label={stopping ? 'Stopping' : 'Stop'} busy={stopping} disabled={stopping} onPress={() => void live.send.stop()}>
            <View style={[styles.stopGlyph, { backgroundColor: colors.onInk }]} />
          </RoundButton>
        ) : (
          <RoundButton label={sendLabel(thread, catalog)} busy={outbox.item?.phase === 'sending'} disabled={empty || slotTaken} onPress={() => void send()}>
            <Text style={[styles.sendGlyph, { color: colors.onInk }]}>↑</Text>
          </RoundButton>
        )}
      </View>
    </View>
  );
}

function RoundButton({
  label,
  busy,
  disabled,
  onPress,
  children,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { colors } = useOmniTheme();
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      hitSlop={space.s2}
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.fg, opacity: disabled && !busy ? 0.3 : 1 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.onInk} /> : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  composer: {
    gap: space.s2,
  },
  nextTurn: {
    flexDirection: 'row',
  },
  notice: {
    fontSize: fontSize.meta,
    paddingHorizontal: space.s6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.s6,
    paddingRight: space.s2,
    paddingVertical: space.s2,
    gap: space.s2,
  },
  input: {
    flex: 1,
    fontSize: fontSize.input,
    lineHeight: INPUT_LINE_HEIGHT,
    minHeight: BUTTON_SIZE,
    maxHeight: INPUT_LINE_HEIGHT * MAX_LINES + 2 * INPUT_PADDING,
    paddingVertical: INPUT_PADDING,
    paddingHorizontal: 0,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  stopGlyph: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
});
