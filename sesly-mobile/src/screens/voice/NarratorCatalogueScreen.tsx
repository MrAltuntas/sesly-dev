/**
 * NarratorCatalogueScreen: "Hazır anlatıcılar", every ready-made narrator of
 * one language.
 *
 * Opened from "Tümü" on the Sesim tab (with the language its filter shows)
 * and from a story whose user has no usable voice yet (`pickForStory`, with
 * the story's language and id). A row of language chips switches the list;
 * the catalogue keeps its own order, a narrator the user added is marked
 * "Eklendi" in place and can be removed there (hidden at once, back when
 * the delete fails, with "Geri al" once it went). A second row of chips
 * narrows the list to women's or men's voices when the language has both
 * (V14: the names alone say little). Tapping a row adds the narrator (slot
 * check in `useAddNarrator`; the row is busy meanwhile and a second tap adds
 * nothing); the round button plays its sample. With `pickForStory` a
 * successful add goes back to the story, which selects the new narrator
 * (`selectVoiceId`). A catalogue that cannot be loaded says so with a retry.
 *
 * The list is virtualised: a language has dozens of narrators.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Chip, SkeletonPulse, StateView, TopAppBar, useScrollEdge } from '../../components/design';
import { RADIUS, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { languageCodeLabel } from '../../i18n/text';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useDialog } from '../../hooks/useDialog';
import { contentLanguageLabel, useContentLanguage } from '../../hooks/useContentLanguage';
import {
  AvailableGoogleVoice,
  languageCodeOf,
  isVoiceProfileFailed,
  isVoiceProfileReady,
  VoiceProfile,
} from '../../models/VoiceProfile';
import { getNarratorDisplay } from '../../models/Narrator';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  NarratorRow,
  NarratorRowSkeleton,
  narratorSlotsLine,
} from '../../components/voice/VoiceCards';
import { useAddNarrator } from '../../components/voice/useAddNarrator';
import { useNarratorPreview } from '../../components/detail/useNarratorPreview';
import {
  NarratorRowModel,
  buildCatalogueRows,
  narratorAvatarSlotFor,
  narratorFilterLanguages,
  narratorLine,
} from '../../components/voice/narratorRows';
import { showToast } from '../../utils/toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'NarratorCatalogue'>;

/** Skeleton rows while a language's catalogue loads. */
const SKELETON_ROWS = 6;

const NO_IDS: ReadonlySet<string> = new Set();

/** The gender filter: every narrator, or the women's or the men's voices. */
export type GenderFilter = 'all' | 'female' | 'male';
const GENDER_FILTERS: readonly GenderFilter[] = ['all', 'female', 'male'];

/** The catalogue's gender of a voice, lower case; '' when unknown. */
const genderOf = (gender: string | null | undefined): string => (gender ?? '').trim().toLowerCase();

/**
 * Rows that match the filter. An added narrator takes the gender of its
 * catalogue entry; a voice of unknown gender is shown only under "Hepsi".
 */
export function filterRowsByGender(
  rows: readonly NarratorRowModel[],
  filter: GenderFilter,
  catalogue: readonly AvailableGoogleVoice[],
): NarratorRowModel[] {
  if (filter === 'all') return [...rows];
  return rows.filter(row => {
    const gender =
      row.kind === 'catalogue'
        ? row.voice.gender
        : catalogue.find(voice => voice.voiceId === row.profile.voiceId)?.gender;
    return genderOf(gender) === filter;
  });
}

/** The filter is offered only when the catalogue has voices of both genders. */
export function offersGenderFilter(catalogue: readonly AvailableGoogleVoice[]): boolean {
  const genders = new Set(catalogue.map(voice => genderOf(voice.gender)));
  return genders.has('female') && genders.has('male');
}

export const NarratorCatalogueScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  // Rows scrolled under the bar fade out under it instead of cutting flush (V18).
  const edge = useScrollEdge();
  const T = useT();
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { t } = useTranslation('voices');
  const { showDialog } = useDialog();
  const voiceProfileStore = useVoiceProfile();
  const contentLanguage = useContentLanguage();
  const adder = useAddNarrator();
  const preview = useNarratorPreview();

  const pickForStory = route.params?.pickForStory === true;
  const storyId = route.params?.storyId;
  const [picked, setPicked] = useState<string | null>(null);
  const language = picked ?? (languageCodeOf(route.params?.language) || contentLanguage.selectable);
  const [gender, setGender] = useState<GenderFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  // Narrators being removed: hidden at once, back when the delete fails.
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(NO_IDS);

  useEffect(() => {
    void contentLanguage.load();
    if (voiceProfileStore.voiceProfiles.length === 0) void voiceProfileStore.loadVoiceProfiles();
    // The hint says how full the list is.
    if (!voiceProfileStore.voiceSlotInfo) void voiceProfileStore.loadVoiceSlots();
  }, [contentLanguage, voiceProfileStore]);

  useEffect(() => {
    if (!voiceProfileStore.catalogueFor(language)) {
      void voiceProfileStore.loadAvailableVoices(language);
    }
  }, [voiceProfileStore, language]);

  // A sample must not keep playing once the user leaves, or opens a screen
  // over this one (the plans).
  const stopPreview = useRef(preview.stop);
  stopPreview.current = preview.stop;
  useFocusEffect(
    useCallback(
      () => () => {
        void stopPreview.current();
      },
      [],
    ),
  );

  const profiles =
    deletingIds.size > 0
      ? voiceProfileStore.voiceProfiles.filter(profile => !deletingIds.has(profile.id))
      : voiceProfileStore.voiceProfiles;
  const loaded = voiceProfileStore.catalogueFor(language);
  const loadError = voiceProfileStore.catalogueErrorFor(language);
  const catalogue = loaded ?? [];
  const showGenders = offersGenderFilter(catalogue);
  // A language without both genders drops a filter picked on another one.
  const activeGender: GenderFilter = showGenders ? gender : 'all';
  const rows = filterRowsByGender(buildCatalogueRows(profiles, catalogue, language), activeGender, catalogue);
  // Read here, not in the cells: the list's cells render outside this
  // observer, so an add on its way must re-render the screen itself.
  const addingPresets: ReadonlySet<string> = new Set(voiceProfileStore.addingPresetIds);
  // Until the catalogue is loaded or has failed: a failure is never an
  // endless skeleton, and a pull to refresh after one never flashes an
  // empty list.
  const loading = loaded === null && !loadError;
  const failed = loaded === null && !!loadError;
  const languages = narratorFilterLanguages(
    contentLanguage.languages.map(item => item.code),
    profiles,
  );
  // On a list of one language the code badge repeats the line.
  const showCodes = languages.length > 1;

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      voiceProfileStore.loadAvailableVoices(language),
      voiceProfileStore.loadVoiceProfiles(),
    ]);
    setRefreshing(false);
  };

  const handleAdd = useCallback(
    async (row: Extract<NarratorRowModel, { kind: 'catalogue' }>) => {
      const created = await adder.add(row.voice);
      if (!created) return;
      if (!pickForStory) {
        showToast.success(t('toasts.added'));
        return;
      }
      // Back to the story, which selects the new narrator: its card says
      // it was added, a message would only cover the story's button.
      if (storyId) nav.popTo('StoryDetail', { storyId, selectVoiceId: created.id });
      else nav.goBack();
    },
    [adder, t, pickForStory, storyId, nav],
  );

  /**
   * Removes at once (VR-04): the row, the "Listende n/3" count (the store
   * stops counting it while the delete runs) and the "Geri al" message all
   * change in the frame of the tap. A failed delete brings the row back and
   * the store shows why, which replaces the message.
   */
  const removeNarrator = useCallback(
    (profile: VoiceProfile): Promise<boolean> => {
      setDeletingIds(prev => new Set(prev).add(profile.id));
      // Its sample stops, also one that is still on its way.
      if (preview.playingId === profile.id || preview.loadingId === profile.id) void preview.stop();
      const deletion = voiceProfileStore.deleteVoiceProfile(profile.id).then(
        deleted => deleted === true,
        () => false,
      );
      void deletion.then(() =>
        setDeletingIds(prev => {
          const next = new Set(prev);
          next.delete(profile.id);
          return next;
        }),
      );
      // "Geri al" adds the same narrator again (V11), once the delete went.
      const voice = voiceProfileStore
        .catalogueFor(profile.contentLanguage || language)
        ?.find(item => item.voiceId === profile.voiceId);
      showToast.success(
        t('toasts.removed'),
        undefined,
        voice
          ? {
              label: t('common:undo'),
              onPress: () => {
                void deletion.then(deleted => {
                  if (deleted) void adder.add(voice);
                });
              },
            }
          : undefined,
      );
      return deletion;
    },
    [preview, voiceProfileStore, t, language, adder],
  );

  const handleRemove = useCallback(
    (profile: VoiceProfile) => {
      const name = getNarratorDisplay(profile)?.name ?? profile.name;
      showDialog({
        title: t('dialogs.remove.title', { name }),
        message: t('dialogs.remove.message'),
        buttons: [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('dialogs.remove.confirm'),
            style: 'destructive',
            onPress: () => {
              void removeNarrator(profile);
            },
          },
        ],
      });
    },
    [showDialog, t, removeNarrator],
  );

  const renderRow = ({ item }: { item: NarratorRowModel }) => {
    if (item.kind === 'added') {
      const profile = item.profile;
      const ready = isVoiceProfileReady(profile);
      // The gender comes from the catalogue entry of the same voice.
      const listed = catalogue.find(voice => voice.voiceId === profile.voiceId);
      return (
        <NarratorRow
          id={profile.id}
          name={getNarratorDisplay(profile)?.name ?? profile.name}
          line={narratorLine(listed ?? { name: profile.name, contentLanguage: profile.contentLanguage })}
          languageCode={showCodes ? profile.contentLanguage : null}
          avatarSlot={narratorAvatarSlotFor(profile.voiceId)}
          added
          statusLabel={
            ready ? undefined : isVoiceProfileFailed(profile) ? t('own.failed') : t('own.preparing')
          }
          playing={preview.playingId === profile.id}
          loadingPreview={preview.loadingId === profile.id}
          onTogglePreview={() => void preview.toggle(profile)}
          onRemove={() => handleRemove(profile)}
        />
      );
    }
    const voice = item.voice;
    if (addingPresets.has(voice.voiceId)) {
      // Added from the tap on (VR-03); the remove button comes with the profile.
      return (
        <NarratorRow
          id={voice.voiceId}
          name={voice.name}
          line={narratorLine(voice)}
          languageCode={showCodes ? voice.contentLanguage || voice.languageCode : null}
          avatarSlot={narratorAvatarSlotFor(voice.voiceId)}
          added
          playing={preview.playingId === item.key}
          loadingPreview={preview.loadingId === item.key}
          onTogglePreview={() => void preview.toggleVoice(voice)}
        />
      );
    }
    return (
      <NarratorRow
        id={voice.voiceId}
        name={voice.name}
        line={narratorLine(voice)}
        languageCode={showCodes ? voice.contentLanguage || voice.languageCode : null}
        avatarSlot={narratorAvatarSlotFor(voice.voiceId)}
        playing={preview.playingId === item.key}
        loadingPreview={preview.loadingId === item.key}
        adding={adder.addingId === voice.voiceId}
        onPress={() => void handleAdd(item)}
        onTogglePreview={() => void preview.toggleVoice(voice)}
      />
    );
  };

  const header = (
    <View style={styles.header}>
      {languages.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.languages}
          style={styles.languageStrip}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('narrators.languageFilter')}
          testID="catalogue-language-filter"
        >
          {languages.map(code => {
            const selected = code === language;
            return (
              <Chip
                key={code}
                label={contentLanguage.nativeName(code)}
                selected={selected}
                leading={
                  <View style={[styles.chipCode, selected ? styles.chipCodeOn : null]}>
                    <Text style={[styles.chipCodeText, { color: selected ? T.onAction : T.text }]}>
                      {languageCodeLabel(code)}
                    </Text>
                  </View>
                }
                onPress={() => setPicked(code)}
                testID={`catalogue-language-${code}`}
              />
            );
          })}
        </ScrollView>
      ) : null}
      {showGenders ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('catalogue.genderFilter')}
          style={styles.genders}
          testID="catalogue-gender-filter"
        >
          {GENDER_FILTERS.map(option => (
            <Chip
              key={option}
              kind="choice"
              label={t(`catalogue.gender.${option}`)}
              selected={activeGender === option}
              onPress={() => setGender(option)}
              testID={`catalogue-gender-${option}`}
            />
          ))}
        </View>
      ) : null}
      <Text style={[text.bodySmall, styles.hint]} testID="catalogue-hint">
        {[
          t(pickForStory ? 'narrators.pickHint' : 'narrators.hint'),
          narratorSlotsLine(voiceProfileStore.presetSlots, t),
        ]
          .filter(Boolean)
          .join(' ')}
      </Text>
    </View>
  );

  // The catalogue failed: alone it fills the list; under the user's added
  // narrators of the language it follows them, without the big icon.
  const errorState = (withIcon: boolean) => (
    <StateView
      icon={withIcon ? 'wifiOff' : undefined}
      title={t('catalogue.errorTitle')}
      message={t('catalogue.errorMessage')}
      actionLabel={t('common:retry')}
      onAction={() => void voiceProfileStore.loadAvailableVoices(language)}
      testID="catalogue-error"
    />
  );

  const empty = loading ? (
    <SkeletonPulse testID="catalogue-loading" label={t('narrators.loading')} style={styles.list}>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <NarratorRowSkeleton key={i} />
      ))}
    </SkeletonPulse>
  ) : failed ? (
    errorState(true)
  ) : (
    <StateView
      icon="mic"
      title={t('catalogue.emptyTitle')}
      message={
        loaded !== null
          ? t('narrators.emptyLanguage', { language: contentLanguageLabel(language) })
          : t('narrators.empty')
      }
      testID="catalogue-empty"
    />
  );

  return (
    <View style={styles.container} testID="narrator-catalogue">
      <TopAppBar
        variant="back"
        title={t('sections.narrators')}
        onBack={() => nav.goBack()}
        scrolled={edge.scrolled}
      />
      <FlatList
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        data={loading ? [] : rows}
        keyExtractor={item => item.key}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={failed && rows.length > 0 ? errorState(false) : null}
        ItemSeparatorComponent={RowGap}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACE.xxl }]}
        initialNumToRender={10}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
        testID="catalogue-list"
      />
    </View>
  );
});

const RowGap: React.FC = () => <View style={{ height: SPACE.md }} />;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    content: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.xs },
    header: { marginBottom: SPACE.md },
    // The chip strip scrolls edge to edge, its first chip on the page gutter.
    languageStrip: { marginHorizontal: -T.screenPadH },
    languages: { gap: SPACE.sm, paddingHorizontal: T.screenPadH, paddingVertical: SPACE.tight },
    genders: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
    hint: { marginTop: SPACE.sm },
    list: { gap: SPACE.md },
    chipCode: {
      minHeight: 16,
      paddingHorizontal: SPACE.xs,
      borderRadius: RADIUS.xs,
      justifyContent: 'center',
      backgroundColor: withAlpha(T.text, 0.12),
    },
    chipCodeOn: { backgroundColor: withAlpha(T.onAction, 0.16) },
    chipCodeText: { fontFamily: T.fontLabel, fontSize: 10, lineHeight: 14, letterSpacing: 0.3 },
  });

const stylesFor = themedStyles(makeStyles);

export default NarratorCatalogueScreen;
