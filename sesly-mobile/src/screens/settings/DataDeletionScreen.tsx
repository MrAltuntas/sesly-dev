/**
 * DataDeletionScreen: the account deletion flow, opened from "Hesabı sil" on
 * the profile (design/v4/playful; no frame of its own).
 *
 * A card that says what is removed (an error-tinted alert tile, one icon
 * tile per item) and, below the list and only for a paid plan, a note that
 * deleting the account does not cancel the store subscription (it is not a
 * removed item), the confirmation in a card of its own, the danger primary
 * button, and the e-mail request as the other way.
 *
 * Steps: read what is removed, tick the confirmation, press the button,
 * confirm once more in a dialog. On iOS an Apple account first confirms with
 * Apple once more so its Sign in with Apple tokens are revoked
 * (`AuthService.revokeAppleSignIn`; closing the Apple sheet stops here, any
 * other revoke failure is reported and the delete goes on). Then DELETE /users/me through
 * `UserService.deleteAccount` (docs/release-pass/SPEC-startup.md 3.7):
 *   - done: "Hesabın silindi", then sign out;
 *   - 401 or 404: the account is already gone (the JWT strategy answers 401
 *     for a deleted user), so sign out;
 *   - anything else: the account still exists, so the user stays signed in
 *     and a dialog offers to run the delete again.
 */

import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { RADIUS, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import {
  Button,
  Card,
  Checkbox,
  Icon,
  IconName,
  SectionLabel,
  TopAppBar,
} from '../../components/design';
import { withAlpha } from '../../theme/color';
import { SUPPORT_EMAIL, supportMailUrl } from '../../components/profile/support';
import { useAuth } from '../../hooks/useAuth';
import { useDialog } from '../../hooks/useDialog';
import { useSubscription } from '../../hooks/useSubscription';
import { showToast } from '../../utils/toast';
import UserService from '../../services/UserService';
import AuthService from '../../services/AuthService';
import { isAuthCancelledError } from '../../services/authErrors';
import { recordNonFatal } from '../../services/crashReporting';
import { AuthProvider } from '../../types/enums';
import { hasApiStatus } from '../../services/ApiError';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const REMOVED_ITEMS: readonly { key: string; icon: IconName }[] = [
  { key: 'profile', icon: 'user' },
  { key: 'narrations', icon: 'books' },
  { key: 'voices', icon: 'mic' },
];

/** The delete answered that there is no such account (any more). */
export function isAlreadyDeleted(error: unknown): boolean {
  return hasApiStatus(error, 401) || hasApiStatus(error, 404);
}

const DataDeletionScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { t } = useTranslation('profile');
  const authStore = useAuth();
  const subscriptionStore = useSubscription();
  const { showDialog } = useDialog();

  const [confirmed, setConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEmailPress = () => {
    Linking.openURL(supportMailUrl()).catch(() => {
      showDialog({
        title: t('contact.failedTitle'),
        message: t('deletion.mailFailedMessage'),
        buttons: [{ text: t('common:ok') }],
      });
    });
  };

  const signOut = async () => {
    try {
      await authStore.signOut();
    } catch (err) {
      console.error('Sign out after delete failed', err);
    }
  };

  const runDelete = async (): Promise<void> => {
    setIsDeleting(true);
    if (Platform.OS === 'ios' && authStore.backendUser?.provider === AuthProvider.APPLE) {
      try {
        await AuthService.revokeAppleSignIn();
      } catch (err) {
        if (isAuthCancelledError(err)) {
          // The user closed the Apple sheet: nothing is deleted.
          setIsDeleting(false);
          return;
        }
        // Revoking is best effort: the account is deleted anyway.
        recordNonFatal(err, 'app', { step: 'apple-revoke' });
      }
    }
    try {
      await UserService.deleteAccount();
    } catch (err) {
      if (isAlreadyDeleted(err)) {
        await signOut();
        setIsDeleting(false);
        return;
      }
      // The account is still there: stay signed in and offer the delete again.
      console.error('Delete account failed', err);
      setIsDeleting(false);
      showDialog({
        title: t('deletion.failedTitle'),
        message: t('deletion.failed'),
        buttons: [
          { text: t('common:retry'), onPress: () => runDelete() },
          { text: t('common:cancel'), style: 'cancel' },
        ],
      });
      return;
    }
    showToast.success(t('deletion.done'));
    await signOut();
    setIsDeleting(false);
  };

  const handleDelete = () => {
    if (!confirmed || isDeleting) return;
    showDialog({
      title: t('deletion.title'),
      message: t('deletion.dialogMessage'),
      buttons: [
        { text: t('deletion.title'), style: 'destructive', onPress: () => runDelete() },
        { text: t('common:cancel'), style: 'cancel' },
      ],
    });
  };

  return (
    <View style={styles.container}>
      <TopAppBar variant="back" title={t('deletion.title')} onBack={() => nav.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACE.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* What is removed */}
        <Card testID="deletion-warning" contentStyle={styles.warning}>
          <View style={styles.warningIcon} testID="deletion-warning-icon">
            <Icon name="alert" size={26} color={T.error} />
          </View>
          <Text accessibilityRole="header" style={[text.heading, styles.heading]}>
            {t('deletion.heading')}
          </Text>
          <Text style={[text.bodySmall, styles.intro]}>{t('deletion.intro')}</Text>
          <View style={styles.items}>
            {REMOVED_ITEMS.map(item => (
              <View key={item.key} style={styles.item}>
                <View style={styles.itemTile} testID={`deletion-item-${item.key}`}>
                  <Icon name={item.icon} size={20} color={T.error} />
                </View>
                <Text style={styles.itemText}>{t(`deletion.items.${item.key}`)}</Text>
              </View>
            ))}
          </View>
          {/* Not one of the removed items: a store subscription outlives the
              account, so a paid plan is told to cancel it in the store first. */}
          {subscriptionStore.isPaid ? (
            <View style={[styles.item, styles.subscriptionNote]} testID="deletion-subscription-note">
              <View style={[styles.itemTile, styles.noteTile]} testID="deletion-subscription-icon">
                <Icon name="info" size={20} color={T.warning} />
              </View>
              <Text style={styles.itemText}>{t('deletion.subscriptionNote')}</Text>
            </View>
          ) : null}
        </Card>

        {/* Confirmation */}
        <Card
          testID="deletion-confirm-card"
          style={styles.confirmCard}
          contentStyle={styles.confirmRow}
        >
          <Checkbox
            checked={confirmed}
            onToggle={() => setConfirmed(value => !value)}
            accessibilityLabel={t('deletion.confirmCheck')}
            testID="deletion-confirm"
          />
          <Pressable
            onPress={() => setConfirmed(value => !value)}
            accessible={false}
            style={styles.confirmLabel}
          >
            <Text style={styles.confirmText}>{t('deletion.confirmCheck')}</Text>
          </Pressable>
        </Card>

        <Button
          label={isDeleting ? t('deletion.submitting') : t('deletion.submit')}
          tone="danger"
          size="lg"
          block
          icon="trash"
          disabled={!confirmed}
          loading={isDeleting}
          onPress={handleDelete}
          style={styles.submit}
          testID="deletion-submit"
        />

        {/* The other way: a request by e-mail */}
        <SectionLabel style={styles.altSection}>{t('deletion.alt.section')}</SectionLabel>
        <Card testID="deletion-alt" contentStyle={styles.altCard}>
          <Text style={text.subheading}>{t('deletion.alt.title')}</Text>
          <Text style={[text.bodySmall, styles.altMessage]}>{t('deletion.alt.message')}</Text>
          <Button
            label={SUPPORT_EMAIL}
            variant="secondary"
            size="sm"
            icon="mail"
            onPress={handleEmailPress}
            style={styles.altAction}
            testID="deletion-mail"
          />
        </Card>
      </ScrollView>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    content: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.md },

    warning: { padding: SPACE.lg },
    warningIcon: {
      width: 52,
      height: 52,
      borderRadius: RADIUS.md,
      backgroundColor: withAlpha(T.error, 0.14),
      alignItems: 'center',
      justifyContent: 'center',
    },
    heading: { marginTop: SPACE.md },
    intro: { marginTop: SPACE.tight },
    items: { marginTop: SPACE.md, gap: SPACE.sm },
    item: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    itemTile: {
      width: 34,
      height: 34,
      borderRadius: RADIUS.sm,
      backgroundColor: T.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemText: { flex: 1, fontFamily: T.fontLabel, fontSize: 14, lineHeight: 19, color: T.text },
    subscriptionNote: {
      marginTop: SPACE.md,
      paddingTop: SPACE.md,
      borderTopWidth: T.hairline,
      borderTopColor: T.line,
      alignItems: 'flex-start',
    },
    noteTile: { backgroundColor: withAlpha(T.warning, 0.14) },

    confirmCard: { marginTop: SPACE.lg },
    confirmRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: SPACE.xs,
      paddingLeft: SPACE.xs,
      paddingRight: SPACE.md,
    },
    confirmLabel: { flex: 1, minHeight: 48, justifyContent: 'center', paddingVertical: SPACE.tight },
    confirmText: { fontFamily: T.fontLabel, fontSize: 14, lineHeight: 19, color: T.text },

    submit: { marginTop: SPACE.xl },

    altSection: { marginTop: SPACE.xxxl, marginBottom: SPACE.sm },
    altCard: { padding: SPACE.lg },
    altMessage: { marginTop: SPACE.tight },
    altAction: { marginTop: SPACE.md },
  });

const stylesFor = themedStyles(makeStyles);

export default DataDeletionScreen;
