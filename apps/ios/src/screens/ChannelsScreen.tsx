import { useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { ChannelWithRunning } from '@omni/client-core';

import { channelSections } from '../live/channel-model';
import { useChannels, useLink, useLiveHub, usePullRefresh } from '../live/react';
import { ListHeading } from '../components/ListHeading';
import { StatusLine } from '../components/StatusLine';
import type { RootScreenProps } from '../navigation/types';
import { usePairing } from '../pairing/PairingProvider';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { fontSize, minTarget, space, useOmniTheme } from '../theme';

interface ChannelSection {
  title: string | null;
  data: ChannelWithRunning[];
}

export function ChannelsScreen({ navigation }: RootScreenProps<'Channels'>) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const pull = usePullRefresh();
  const { channels, error } = useChannels();
  const link = useLink();
  const { activeServer, statusById, notice, clearNotice } = usePairing();
  const incompatible = activeServer !== null && statusById[activeServer.id] === 'incompatible';

  const sections = useMemo<ChannelSection[]>(() => {
    if (!channels) return [];
    const model = channelSections(channels);
    const out: ChannelSection[] = [];
    if (model.conductor) out.push({ title: null, data: [model.conductor] });
    for (const group of model.groups) out.push({ title: group.label, data: group.channels });
    return out;
  }, [channels]);

  const empty = channels !== null && sections.length === 0;

  return (
    <SectionList
      sections={sections}
      keyExtractor={(channel) => channel.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.fg3}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {notice !== null && (
            <Callout message={notice}>
              <Button label="Dismiss" variant="secondary" onPress={clearNotice} />
            </Callout>
          )}
          {incompatible && <Callout message="This server speaks an API this app doesn't support. Update the app or the server." />}
          <StatusLine />
          {channels && error ? (
            <Text style={[styles.note, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        channels === null ? (
          <Empty
            title={link.kind === 'unpaired' ? 'No server connected' : error ? 'Could not load channels' : 'Loading channels'}
            body={link.kind === 'unpaired' ? 'Pair this phone with an Omni server to see its channels.' : error ?? undefined}
            action={error && link.kind !== 'unpaired' ? { label: 'Try again', onPress: () => void hub.refreshChannels() } : undefined}
          />
        ) : empty ? (
          <Empty title="No channels yet" body="Channels appear here once the server has one." />
        ) : undefined
      }
      renderSectionHeader={({ section }) => (section.title ? <ListHeading>{section.title}</ListHeading> : <View style={styles.conductorGap} />)}
      renderItem={({ item }) => (
        <ChannelRow channel={item} onPress={() => navigation.navigate('Channel', { id: item.id })} />
      )}
      stickySectionHeadersEnabled={false}
    />
  );
}

function ChannelRow({ channel, onPress }: { channel: ChannelWithRunning; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const running = channel.running || 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={running > 0 ? `${channel.name}, ${running} running` : channel.name}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : colors.bg, borderColor: colors.line }]}
    >
      <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
        {channel.name}
      </Text>
      {running > 0 ? <Text style={[styles.running, { color: colors.fg3 }]}>{`${running} running`}</Text> : null}
      <Text style={[styles.chevron, { color: colors.fg4 }]}>›</Text>
    </Pressable>
  );
}

function Empty({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.fg }]}>{title}</Text>
      {body ? <Text style={[styles.emptyBody, { color: colors.fg3 }]}>{body}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <Text style={[styles.actionLabel, { color: colors.fg }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
    gap: space.s2,
  },
  note: {
    fontSize: fontSize.meta,
    paddingBottom: space.s2,
  },
  conductorGap: {
    height: space.s6,
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingHorizontal: space.s9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: {
    flex: 1,
    fontSize: fontSize.input,
    fontWeight: '500',
  },
  running: {
    fontSize: fontSize.meta,
  },
  chevron: {
    fontSize: fontSize.heading + 4,
    lineHeight: 22,
  },
  empty: {
    paddingHorizontal: space.s9,
    paddingTop: space.s11,
    gap: space.s4,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  emptyBody: {
    fontSize: fontSize.body,
  },
  action: {
    minHeight: minTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  actionLabel: {
    fontSize: fontSize.input,
    fontWeight: '600',
  },
});
