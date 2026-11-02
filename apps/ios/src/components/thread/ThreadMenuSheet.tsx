import type { Folder } from '@omni/client-core';
import type { ThreadActionIcon, ThreadActionId } from '@omni/shared/thread-actions.ts';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { fontSize, space, useOmniTheme } from '../../theme';
import type { ThreadAction } from '../../thread/actions';
import { useThreadActions } from '../../thread/hooks';
import { folderChoices, organizeItems, type ThreadTarget } from '../../thread/target';
import { Callout } from '../../ui/Callout';
import { OptionGroup, OptionRow } from '../../ui/OptionRow';
import { Sheet } from '../../ui/Sheet';

const GLYPH: Record<ThreadActionIcon, string> = {
  pin: '📌',
  check: '✓',
  pencil: '✏️',
  folder: '📁',
  archive: '🗄',
  branch: '⑂',
  message: '💬',
  grok: '✦',
};

interface ThreadMenuSheetProps {
  /** The thread the menu acts on, as it is now: the sheet opens when this is set and shows the labels for its state. */
  target: ThreadTarget | null;
  /** The thread's channel folders, for Move to folder. */
  folders: readonly Pick<Folder, 'id' | 'parent_id' | 'name'>[];
  onClose: () => void;
  /** An action went through: say what it did where the user is looking. */
  onChanged: (message: string) => void;
}

/** The thread menu as a sheet: pin, done, rename, move to folder and archive, from the header and from a list row. */
export function ThreadMenuSheet({ target, folders, onClose, onChanged }: ThreadMenuSheetProps) {
  const { colors } = useOmniTheme();
  const run = useThreadActions();
  const [page, setPage] = useState<'menu' | 'move'>('menu');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = target !== null;

  useEffect(() => {
    if (open) return;
    setPage('menu');
    setError(null);
  }, [open]);

  const items = useMemo(() => (target ? organizeItems(target) : []), [target]);
  const choices = useMemo(() => folderChoices(folders, target?.folderId ?? null), [folders, target?.folderId]);

  async function perform(action: ThreadAction) {
    if (!target || pending) return;
    setPending(true);
    setError(null);
    const outcome = await run(target, action);
    setPending(false);
    if (outcome.kind === 'failed') {
      setError(outcome.error);
      return;
    }
    if (outcome.kind === 'changed') onChanged(outcome.message);
    onClose();
  }

  function rename() {
    if (!target) return;
    Alert.prompt('Rename thread', undefined, (title) => void perform({ kind: 'rename', title }), 'plain-text', target.title);
  }

  function choose(id: ThreadActionId) {
    if (id === 'pin') void perform({ kind: 'pin' });
    else if (id === 'done') void perform({ kind: 'done' });
    else if (id === 'archive') void perform({ kind: 'archive' });
    else if (id === 'rename') rename();
    else if (id === 'move') setPage('move');
  }

  const accessory = pending ? (
    <ActivityIndicator color={colors.fg3} />
  ) : page === 'move' ? (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={() => setPage('menu')}>
      <Text style={[styles.back, { color: colors.fg }]}>‹ Back</Text>
    </Pressable>
  ) : null;

  return (
    <Sheet visible={open} title={page === 'move' ? 'Move to folder' : 'Thread'} onClose={onClose} accessory={accessory}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Callout message={error} /> : null}
        {page === 'menu' ? (
          <OptionGroup>
            {items.map((item, i) => (
              <OptionRow
                key={item.id}
                label={item.label}
                sub={item.off ?? item.hint}
                leading={<Text style={[styles.glyph, { color: colors.fg }]}>{GLYPH[item.icon]}</Text>}
                opens={item.id === 'move'}
                disabled={pending || !!item.off}
                onPress={() => choose(item.id)}
                last={i === items.length - 1}
              />
            ))}
          </OptionGroup>
        ) : (
          <>
            <OptionGroup>
              {choices.map((choice, i) => (
                <OptionRow
                  key={choice.id ?? 'none'}
                  label={choice.name}
                  depth={choice.depth}
                  selected={choice.current}
                  disabled={pending}
                  onPress={() => void perform({ kind: 'move', folderId: choice.id })}
                  last={i === choices.length - 1}
                />
              ))}
            </OptionGroup>
            {folders.length === 0 ? (
              <Text style={[styles.note, { color: colors.fg3 }]}>This channel has no folders yet. Make one on the Web UI or the Mac app, then move threads into it here.</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
  glyph: {
    fontSize: 18,
  },
  back: {
    fontSize: fontSize.input,
  },
  note: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
  },
});
