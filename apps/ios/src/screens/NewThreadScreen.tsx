import type { DraftRun } from '@omni/shared/draft-run.ts';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { HeaderButton } from '../components/HeaderButton';
import { RunOptions } from '../components/thread/RunOptions';
import { useChannels } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import {
  applyPick,
  createRequest,
  CONDUCTOR,
  draftChipLabel,
  draftSheetModel,
  shownDraftRun,
  targetsOf,
  type DraftInputs,
  type DraftPick,
} from '../newthread/draft';
import { useCrew, useStartThread } from '../newthread/hooks';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../theme';
import { useHarnessCatalog } from '../thread/hooks';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Sheet } from '../ui/Sheet';

/** The phone web's New sheet (apps/web/src/mobile/NewSheet.tsx) for iOS. */
export function NewThreadScreen({ navigation, route }: RootScreenProps<'NewThread'>) {
  const { colors } = useOmniTheme();
  const { channels } = useChannels();
  const crew = useCrew();
  const [target, setTarget] = useState(route.params?.channel ?? CONDUCTOR);
  const [text, setText] = useState('');
  const [pick, setPick] = useState<{ target: string; run: DraftRun } | null>(null);
  const [picking, setPicking] = useState(false);
  const strip = useRef<ComponentRef<typeof ScrollView>>(null);
  const centered = useRef(false);
  const catalog = useHarnessCatalog(target, true);
  const { state, start, dismiss } = useStartThread();
  const starting = state.status === 'starting';

  const inputs: DraftInputs = {
    target,
    text,
    picked: pick?.target === target ? pick.run : null,
    channels: channels ?? [],
    crew: crew ?? [],
    harnesses: catalog.harnesses,
  };
  const request = createRequest(inputs);
  const shown = shownDraftRun(inputs);
  const targets = useMemo(() => targetsOf(channels), [channels]);
  const ready = request !== null && crew !== null && !starting;

  const submit = async () => {
    if (!request || crew === null) return;
    const thread = await start(request);
    if (thread) navigation.replace('Thread', { id: thread.id });
  };
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    navigation.setOptions({
      title: target === CONDUCTOR ? 'New delegation' : 'New thread',
      headerLeft: () => <HeaderButton label="Cancel" onPress={() => navigation.goBack()} />,
      headerRight: () => <HeaderButton label={starting ? 'Starting' : 'Start'} disabled={!ready} onPress={() => void submitRef.current()} />,
    });
  }, [navigation, target, ready, starting]);

  const onTarget = (id: string) => {
    if (id === target) return;
    setTarget(id);
    dismiss();
  };
  const chip = shown && catalog.harnesses ? draftChipLabel(shown, catalog.harnesses) : null;
  const channelName = targets.find((t) => t.id === target)?.name;

  const onPick = (p: DraftPick) => {
    if (shown) setPick({ target, run: applyPick(shown, p) });
  };
  const sheet = shown && catalog.harnesses ? draftSheetModel(shown, catalog.harnesses) : null;

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
          {targets.map((t) => (
            <TargetPill
              key={t.id}
              label={t.id === CONDUCTOR ? t.name : `#${t.name}`}
              on={t.id === target}
              onPress={() => onTarget(t.id)}
              onLayout={(x) => {
                if (t.id !== target || centered.current) return;
                centered.current = true;
                strip.current?.scrollTo({ x: Math.max(0, x - space.s11), animated: false });
              }}
            />
          ))}
        </ScrollView>
        <TextInput
          autoFocus
          multiline
          value={text}
          onChangeText={(next) => {
            setText(next);
            dismiss();
          }}
          editable={!starting}
          accessibilityLabel="First message"
          placeholder={target === CONDUCTOR ? 'Ask the Conductor. It delegates to the crew.' : `Describe the task for #${channelName ?? target}`}
          placeholderTextColor={colors.fg4}
          style={[styles.input, { color: colors.fg, backgroundColor: colors.surface }]}
          textAlignVertical="top"
        />
        <View style={styles.runRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chip ? `Model: ${chip}` : 'Model'}
            accessibilityHint="Opens the model and effort picker"
            disabled={!shown || starting}
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.surface3 : colors.surface2, opacity: shown ? 1 : 0.5 }]}
          >
            {chip ? (
              <Text numberOfLines={1} style={[styles.chipLabel, { color: colors.fg }]}>
                {chip}
              </Text>
            ) : (
              <ActivityIndicator color={colors.fg3} />
            )}
            <Text style={[styles.caret, { color: colors.fg3 }]}>▾</Text>
          </Pressable>
        </View>
        {state.status === 'failed' ? (
          <View style={styles.notice}>
            <Callout message={state.failure.message}>
              {state.failure.kind === 'offline' || state.failure.kind === 'server' ? <Button label="Try again" onPress={() => void submit()} /> : null}
            </Callout>
          </View>
        ) : null}
        {catalog.error && !catalog.harnesses && state.status !== 'failed' ? (
          <View style={styles.notice}>
            <Callout message={catalog.error}>
              <Button label="Try again" variant="secondary" onPress={catalog.reload} />
            </Callout>
          </View>
        ) : null}
      </ScrollView>
      <Sheet visible={picking} title="Model" onClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          {sheet ? (
            <RunOptions
              model={sheet}
              disabled={false}
              auto={{ selected: sheet.auto, onPress: () => onPick('auto') }}
              onEffort={(effort) => onPick({ effort })}
              onModel={(harness, model) => onPick({ harness, model })}
            />
          ) : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

function TargetPill({ label, on, onPress, onLayout }: { label: string; on: boolean; onPress: () => void; onLayout: (x: number) => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x)}
      style={[styles.pill, { backgroundColor: on ? colors.fg : colors.surface2 }]}
    >
      <Text numberOfLines={1} style={[styles.pillLabel, { color: on ? colors.onInk : colors.fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space.s6,
    paddingVertical: space.s6,
  },
  strip: {
    gap: space.s4,
    paddingHorizontal: space.s8,
  },
  pill: {
    height: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: space.s6,
  },
  pillLabel: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  input: {
    minHeight: 160,
    marginHorizontal: space.s8,
    borderRadius: radius.md,
    padding: space.s8,
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  notice: {
    paddingHorizontal: space.s8,
  },
  runRow: {
    flexDirection: 'row',
    paddingHorizontal: space.s8,
  },
  chip: {
    height: 36,
    minWidth: minTarget,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s4,
    borderRadius: radius.pill,
    paddingHorizontal: space.s6,
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  caret: {
    fontSize: fontSize.meta,
  },
  sheetContent: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
});
