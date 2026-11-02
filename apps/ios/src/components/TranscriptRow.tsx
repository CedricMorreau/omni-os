import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TranscriptItem } from '../live/transcript';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../theme';
import { type DotTone, StatusDot } from './StatusDot';
import { UserBubble } from './UserBubble';

/** One folded transcript item, as the desktop draws it. */
export function TranscriptRow({ item, onLoadWhole }: { item: TranscriptItem; onLoadWhole: (eventId: number) => void }) {
  const { colors } = useOmniTheme();

  switch (item.kind) {
    case 'user':
      return (
        <UserBubble
          text={item.text}
          caption={[item.mode ? MODE_LABEL[item.mode] : null, item.dropped ? 'Not delivered' : null].filter(Boolean).join(' · ') || 'You'}
        >
          {item.clipped ? <LoadWhole onPress={() => onLoadWhole(item.key)} /> : null}
        </UserBubble>
      );

    case 'text':
      return (
        <View style={styles.block}>
          <Text selectable style={[styles.answer, { color: colors.fg }]}>
            {item.text}
          </Text>
          {item.clipped ? <LoadWhole onPress={() => onLoadWhole(item.key)} /> : null}
        </View>
      );

    case 'tool': {
      const tone: DotTone = item.state === 'error' ? 'warn' : item.state === 'running' ? 'ok' : 'muted';
      const label = item.state === 'running' ? 'Running' : item.state === 'error' ? 'Failed' : null;
      return (
        <View style={[styles.tool, item.depth === 1 && styles.nested]}>
          <View style={styles.toolDot}>
            <StatusDot tone={tone} />
          </View>
          <View style={styles.toolBody}>
            <Text style={[styles.toolName, { color: colors.fg2 }]}>
              {item.name}
              {label ? <Text style={{ color: colors.fg3 }}>{`  ${label}`}</Text> : null}
            </Text>
            {item.summary ? (
              <Text numberOfLines={1} style={[styles.toolSummary, { color: colors.fg3 }]}>
                {item.summary}
              </Text>
            ) : null}
          </View>
        </View>
      );
    }

    case 'error':
      return (
        <View style={[styles.errorBox, { borderColor: colors.lineStrong }]}>
          <Text style={[styles.caption, { color: colors.fg3 }]}>Error</Text>
          <Text selectable style={[styles.errorText, { color: colors.fg }]}>
            {item.text}
          </Text>
        </View>
      );

    case 'end':
      return (
        <View style={styles.end}>
          <View style={[styles.rule, { backgroundColor: colors.line }]} />
          <Text style={[styles.caption, { color: colors.fg3 }]}>
            {[END_LABEL[item.status], item.durationMs !== null ? formatDuration(item.durationMs) : null, item.costUsd !== null ? formatCost(item.costUsd) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      );
  }
}

const MODE_LABEL = { steer: 'Read mid-turn', queue: 'Queued', interrupt: 'Interrupted' } as const;
const END_LABEL = { done: 'Done', failed: 'Failed', stopped: 'Stopped' } as const;

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

function LoadWhole({ onPress }: { onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.loadWhole}>
      <Text style={[styles.loadWholeLabel, { color: colors.fg }]}>Load whole message</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.s2,
  },
  answer: {
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  caption: {
    fontSize: fontSize.meta,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s6,
    paddingVertical: space.s2,
  },
  nested: {
    paddingLeft: space.s9,
  },
  toolDot: {
    paddingTop: 5,
  },
  toolBody: {
    flex: 1,
    gap: space.s2,
  },
  toolName: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  toolSummary: {
    fontSize: fontSize.meta,
    fontFamily: 'Menlo',
  },
  errorBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.s8,
    gap: space.s2,
  },
  errorText: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  end: {
    gap: space.s4,
    paddingVertical: space.s2,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginBottom: space.s2,
  },
  loadWhole: {
    minHeight: minTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  loadWholeLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
