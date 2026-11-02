import { useHeaderHeight } from '@react-navigation/elements';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Notice } from '../components/Notice';
import { ThreadBody } from '../components/thread/ThreadBody';
import { ThreadComposer } from '../components/thread/ThreadComposer';
import { ThreadFooter } from '../components/thread/ThreadFooter';
import { ThreadHeader } from '../components/thread/ThreadHeader';
import { useThreadLive, useThreadView } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { useOmniTheme } from '../theme';

export function ThreadScreen({ route, navigation }: RootScreenProps<'Thread'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const headerHeight = useHeaderHeight();

  const title = view?.thread?.title || 'Thread';
  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  if (!view || view.status === 'loading') return <Notice title="Loading thread" />;
  if (view.status === 'missing') return <Notice title="Thread not found" body="It may have been archived or removed on the server." />;
  if (view.status === 'error' && !view.thread) {
    return <Notice title="Could not open this thread" body={view.error ?? undefined} action={{ label: 'Try again', onPress: () => live?.retry() }} />;
  }

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ThreadHeader view={view} />
      <ThreadBody view={view} live={live} />
      {live && view.thread ? (
        <ThreadFooter>
          <ThreadComposer live={live} thread={view.thread} />
        </ThreadFooter>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
