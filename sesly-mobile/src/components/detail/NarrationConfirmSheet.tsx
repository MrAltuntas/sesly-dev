/**
 * NarrationConfirmSheet: the last look before a NEW narration is generated
 * (the story page's narrate action, "Baştan hazırla", and "Yeniden hazırla"
 * on the generation screen). It prevents a mis-tap and tells the parent one
 * last time what is about to be read and by whom:
 *
 *   - the story: cover, title, part ("Bölüm 2 / 3"), language, length, age
 *     group, content warnings and the AI-translation mark;
 *   - the voice: name, kind ("Hazır anlatıcı" / "Kendi sesin"), language,
 *     and what a voice of another language means;
 *   - the cost in plain words from the plan and GET /usage (nothing for an
 *     unlimited allowance); a used-up allowance says so and offers the plans
 *     instead of "Seslendir".
 *
 * Playing a ready narration never opens it. The content is taken when the
 * sheet opens and kept until it has gone (its body never changes height
 * while it is open, and it survives the exit). The choice runs from the
 * sheet's `onClosed`, once: a second tap on "Seslendir" does nothing.
 */

import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { BottomSheet, Button, Icon, PictureCover, Tag, TranslationBadge } from '../design';
import { describeQuotaBlock, type QuotaBlock } from '../../models/Quota';
import { msg } from '../../i18n/messages';
import type { PlanId } from '../../models/Plans';
import type { UsageSummary } from '../../models/Quota';
import { NarratorAvatar } from './NarratorAvatar';
import {
  narrationConfirmModel,
  type ConfirmStory,
  type ConfirmVoice,
  type NarrationConfirmMode,
  type NarrationConfirmModel,
} from './narrationConfirm';

const COVER_WIDTH = 56;
const AVATAR_SIZE = 40;

/** The narration the sheet asks about. */
export interface NarrationConfirmRequest {
  readonly story: ConfirmStory;
  readonly voice: ConfirmVoice;
  readonly mode: NarrationConfirmMode;
}

export interface NarrationConfirmSheetProps {
  visible: boolean;
  /** The sheet asks to close (scrim, back, drag, "Vazgeç" or a choice). */
  onClose: () => void;
  /** Null until a narration is asked about; kept by the caller while the sheet leaves. */
  request: NarrationConfirmRequest | null;
  usage: UsageSummary | null | undefined;
  planId: PlanId;
  /** The ready-made narrators of the story's language, when loaded. */
  catalogue?: readonly { readonly name: string }[] | null;
  /** "Seslendir": runs once, after the sheet has gone. */
  onConfirm: () => void;
  /** "Planları gör" on a used-up allowance: runs after the sheet has gone. */
  onSeePlans: (block: QuotaBlock) => void;
  testID?: string;
}

type Choice = { kind: 'confirm' } | { kind: 'plans'; block: QuotaBlock };

export const NarrationConfirmSheet: React.FC<NarrationConfirmSheetProps> = ({
  visible,
  onClose,
  request,
  usage,
  planId,
  catalogue,
  onConfirm,
  onSeePlans,
  testID = 'narration-confirm-sheet',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  // Re-render when the UI language changes.
  const { t } = useTranslation('detail');

  // Taken when the sheet opens, kept until the next open (the exit keeps it).
  const shown = useRef<NarrationConfirmModel | null>(null);
  const wasVisible = useRef(false);
  // The choice of this open, run from onClosed; a second tap is ignored.
  const choice = useRef<Choice | null>(null);
  if (visible && !wasVisible.current) {
    choice.current = null;
    shown.current = request
      ? narrationConfirmModel({ ...request, usage, planId, catalogue: catalogue ?? null })
      : null;
  }
  wasVisible.current = visible;
  const model = shown.current;

  const choose = (next: Choice) => {
    if (choice.current) return;
    choice.current = next;
    onClose();
  };

  const handleClosed = () => {
    const picked = choice.current;
    choice.current = null;
    if (picked?.kind === 'confirm') onConfirm();
    else if (picked?.kind === 'plans') onSeePlans(picked.block);
  };

  const cost = model?.cost ?? null;
  const usedUp = cost?.state === 'usedUp' ? cost.block : null;
  const usedUpCopy = usedUp ? describeQuotaBlock(usedUp) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={handleClosed}
      title={model?.title}
      scrollable
      testID={testID}
    >
      {model && request ? (
        <View style={styles.body}>
          {/* The story */}
          <View style={styles.storyRow} testID={`${testID}-story`}>
            <PictureCover story={request.story} width={COVER_WIDTH} radius={RADIUS.sm} />
            <View style={styles.storyText}>
              <Text style={text.subheading} numberOfLines={2} testID={`${testID}-title`}>
                {model.storyTitle}
              </Text>
              {model.partLabel ? (
                <Text style={[text.bodySmall, styles.dim]} testID={`${testID}-part`}>
                  {model.partLabel}
                </Text>
              ) : null}
              {model.storyLine ? (
                <Text style={[text.bodySmall, styles.dim]} testID={`${testID}-story-line`}>
                  {model.storyLine}
                </Text>
              ) : null}
            </View>
          </View>
          {model.warnings.length > 0 || model.machineTranslation ? (
            <View style={styles.tags} testID={`${testID}-tags`}>
              {model.warnings.map(warning => (
                <Tag
                  key={warning.key}
                  label={warning.label}
                  icon="info"
                  size="sm"
                  testID={`${testID}-warning-${warning.key}`}
                />
              ))}
              {model.machineTranslation ? (
                <View testID={`${testID}-machine`}>
                  <TranslationBadge kind="machine" />
                </View>
              ) : null}
            </View>
          ) : null}

          {/* The voice */}
          <View
            style={styles.voiceRow}
            accessible
            accessibilityLabel={t('confirm.voiceA11y', { name: model.voiceName, line: model.voiceLine })}
            testID={`${testID}-voice`}
          >
            <NarratorAvatar
              name={model.voiceName}
              tone={model.ownVoice ? 'own' : 'ready'}
              colorKey={request.voice.voiceId || request.voice.id}
              size={AVATAR_SIZE}
              shape="rounded"
            />
            <View style={styles.voiceText}>
              <Text style={text.tile} numberOfLines={1}>
                {model.voiceName}
              </Text>
              <Text style={[text.bodySmall, styles.dim]} testID={`${testID}-voice-line`}>
                {model.voiceLine}
              </Text>
            </View>
          </View>
          {model.languageNote ? (
            <View style={styles.note} testID={`${testID}-language`}>
              <View style={styles.noteIcon}>
                <Icon
                  name={model.languageNote.tone === 'warning' ? 'alert' : 'info'}
                  size={16}
                  color={model.languageNote.tone === 'warning' ? T.warning : T.text3}
                />
              </View>
              <Text style={[text.bodySmall, styles.noteText]} testID={`${testID}-language-text`}>
                {model.languageNote.title ? (
                  <Text style={styles.noteTitle}>{`${model.languageNote.title}. `}</Text>
                ) : null}
                {model.languageNote.text}
              </Text>
            </View>
          ) : null}

          {/* What it costs, or why it cannot be prepared */}
          {model.replaceLine ? (
            <Text style={[text.bodySmall, styles.dim]} testID={`${testID}-replaces`}>
              {model.replaceLine}
            </Text>
          ) : null}
          {cost?.state === 'uses' ? (
            <Text style={[text.bodySmall, styles.dim]} testID={`${testID}-cost`}>
              {cost.line}
            </Text>
          ) : null}
          {usedUpCopy ? (
            <View style={styles.note} testID={`${testID}-used-up`}>
              <View style={styles.noteIcon}>
                <Icon name="lock" size={16} color={T.warning} />
              </View>
              <Text style={[text.bodySmall, styles.noteText]} testID={`${testID}-used-up-text`}>
                <Text style={styles.noteTitle}>{`${usedUpCopy.title}. `}</Text>
                {usedUpCopy.message}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {usedUp ? (
              usedUpCopy?.offerPlans ? (
                <Button
                  label={msg('quota.seePlans')}
                  variant="primary"
                  size="md"
                  block
                  onPress={() => choose({ kind: 'plans', block: usedUp })}
                  testID={`${testID}-plans`}
                />
              ) : null
            ) : (
              <Button
                label={t('confirm.confirm')}
                variant="primary"
                size="md"
                block
                icon="play"
                onPress={() => choose({ kind: 'confirm' })}
                testID={`${testID}-confirm`}
              />
            )}
            <Button
              label={t('common:cancel')}
              variant="secondary"
              size="md"
              block
              onPress={onClose}
              testID={`${testID}-cancel`}
            />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
};

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    body: { gap: SPACE.md, paddingTop: SPACE.xs },
    storyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    storyText: { flex: 1, gap: SPACE.xxs },
    dim: { color: T.text2 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
    voiceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      paddingTop: SPACE.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: T.line,
    },
    voiceText: { flex: 1, gap: SPACE.xxs },
    note: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
    // Centred on the first 19dp line of the text.
    noteIcon: { height: 19, justifyContent: 'center' },
    noteText: { flex: 1, color: T.text2 },
    noteTitle: { color: T.text },
    actions: { gap: SPACE.sm, marginTop: SPACE.xs },
  }),
);
