import { takeoverShown } from '@omni/shared/thread-machine.ts';
import { useHeaderHeight } from '@react-navigation/elements';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { HeaderButton } from '../components/HeaderButton';
import { Notice } from '../components/Notice';
import { HandoffBanner } from '../components/thread/HandoffBanner';
import { RunSheet } from '../components/thread/RunSheet';
import { ThreadBody } from '../components/thread/ThreadBody';
import { ThreadComposer } from '../components/thread/ThreadComposer';
import { ThreadFooter } from '../components/thread/ThreadFooter';
import { TakeoverSheet } from '../components/thread/TakeoverSheet';
import { ThreadHeader } from '../components/thread/ThreadHeader';
import { ThreadMenuSheet } from '../components/thread/ThreadMenuSheet';
import { useChannels, useThreadLive, useThreadView } from '../live/react';
import { useThreadMachine } from '../machine/hooks';
import type { RootScreenProps } from '../navigation/types';
import { useOmniTheme } from '../theme';
import { useHarnessCatalog } from '../thread/hooks';
import { targetOfThread } from '../thread/target';

const FLASH_MS = 3000;
const FORK_FALLBACK_MS = 800;

export function ThreadScreen({ route, navigation }: RootScreenProps<'Thread'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const headerHeight = useHeaderHeight();
  const { channels } = useChannels();
  const [menuOpen, setMenuOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const thread = view?.thread ?? null;
  const machine = useThreadMachine(view);
  const catalog = useHarnessCatalog(thread?.channel_id, thread !== null);
  const target = useMemo(() => (thread ? targetOfThread(thread) : null), [thread]);
  const folders = useMemo(() => channels?.find((c) => c.id === thread?.channel_id)?.folders ?? [], [channels, thread?.channel_id]);

  const title = thread?.title || 'Thread';
  const hasThread = thread !== null;
  useEffect(() => {
    navigation.setOptions({
      title,
      headerRight: hasThread ? () => <HeaderButton label="•••" accessibilityLabel="Thread menu" onPress={() => setMenuOpen(true)} /> : undefined,
    });
  }, [navigation, title, hasThread]);

  // Fork opens a screen, and a screen cannot present while the menu sheet is still dismissing. The menu reports that it is
  // gone through onClose (the sheet's onDismiss), and a timer covers a dismissal that never reports.
  const forking = useRef(false);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (!forking.current) return;
    forking.current = false;
    navigation.navigate('Continue', { id });
  }, [navigation, id]);
  const fork = useCallback(() => {
    forking.current = true;
    setMenuOpen(false);
    setTimeout(closeMenu, FORK_FALLBACK_MS);
  }, [closeMenu]);

  const say = useCallback((message: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(message);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  if (!view || view.status === 'loading') return <Notice title="Loading thread" />;
  if (view.status === 'missing') return <Notice title="Thread not found" body="It may have been archived or removed on the server." />;
  if (view.status === 'error' && !view.thread) {
    return <Notice title="Could not open this thread" body={view.error ?? undefined} action={{ label: 'Try again', onPress: () => live?.retry() }} />;
  }

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ThreadHeader view={view} harnesses={catalog.harnesses} onOpenRun={() => setRunOpen(true)} flash={flash} />
      <HandoffBanner view={view} machine={machine} />
      <ThreadBody view={view} live={live} />
      {live && view.thread ? (
        <ThreadFooter>
          <ThreadComposer live={live} thread={view.thread} harnesses={catalog.harnesses} onOpenRun={() => setRunOpen(true)} />
        </ThreadFooter>
      ) : null}
      <ThreadMenuSheet target={menuOpen ? target : null} folders={folders} onClose={closeMenu} onChanged={say} machine={machine} onFork={fork} />
      <TakeoverSheet
        visible={machine.ui.asking}
        takeover={takeoverShown(view.takeover, view.handoff)}
        busy={machine.ui.sending === 'takeOver'}
        error={machine.takeOverError}
        onConfirm={() => void machine.takeOver()}
        onCancel={machine.closeAsk}
      />
      <RunSheet
        visible={runOpen}
        onClose={() => setRunOpen(false)}
        threadId={id}
        thread={thread}
        busy={thread?.status === 'running' || thread?.status === 'queued'}
        catalog={catalog}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
