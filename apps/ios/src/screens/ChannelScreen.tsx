import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { channelThreads, type ThreadRow } from '../live/channel-model';
import { useChannels, usePullRefresh } from '../live/react';
import { ListHeading } from '../components/ListHeading';
import { StatusLine } from '../components/StatusLine';
import { ThreadMenuSheet } from '../components/thread/ThreadMenuSheet';
import { ThreadSwipeRow } from '../components/ThreadSwipeRow';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, space, useOmniTheme } from '../theme';

interface ThreadSection {
  key: string;
  title: string;
  data: ThreadRow[];
}

export function ChannelScreen({ route, navigation }: RootScreenProps<'Channel'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const pull = usePullRefresh();
  const { channels } = useChannels();
  const channel = channels?.find((c) => c.id === id) ?? null;
  const name = channel?.name ?? null;
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (name) navigation.setOptions({ title: name });
  }, [name, navigation]);

  const sections = useMemo<ThreadSection[]>(() => {
    if (!channel) return [];
    const model = channelThreads(channel, Date.now());
    const out: ThreadSection[] = [];
    if (model.active.length) out.push({ key: 'active', title: 'Active', data: model.active });
    for (const folder of model.folders) {
      const rows = [...folder.active, ...folder.recent];
      if (rows.length) out.push({ key: `folder-${folder.id}`, title: folder.name, data: rows });
    }
    if (model.recent.length) out.push({ key: 'recent', title: 'Recent', data: model.recent });
    return out;
  }, [channel]);

  const open = (threadId: string) => navigation.navigate('Thread', { id: threadId });

  const menuTarget = useMemo(() => {
    for (const section of sections) {
      const row = section.data.find((r) => r.id === menuId);
      if (row) return row.target;
    }
    return null;
  }, [sections, menuId]);

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.id}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bg }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <StatusLine />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.fg }]}>
              {channels === null ? 'Loading threads' : channel ? 'No threads yet' : 'Channel not found'}
            </Text>
            {channel === null && channels !== null ? (
              <Text style={[styles.emptyBody, { color: colors.fg3 }]}>It may have been archived or removed on the server.</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => <ListHeading>{section.title}</ListHeading>}
        renderItem={({ item }) => <ThreadSwipeRow row={item} onPress={() => open(item.id)} onMenu={() => setMenuId(item.id)} />}
        stickySectionHeadersEnabled={false}
      />
      <ThreadMenuSheet target={menuTarget} folders={channel?.folders ?? []} onClose={() => setMenuId(null)} onChanged={() => {}} />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
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
});
