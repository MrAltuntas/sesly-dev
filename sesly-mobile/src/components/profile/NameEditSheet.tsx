/**
 * NameEditSheet: change the first name the app greets the user with
 * (PATCH /users/me through `UserService.updateProfile`), opened from the
 * account card on the profile.
 *
 * The field starts with the current first name. "Kaydet" saves the trimmed
 * name, puts the answer into the auth store (`updateBackendUser`, which also
 * refreshes the cached user), says so and closes. A failed save keeps the
 * sheet open with the typed name and an error message, so a retry is one
 * tap. An unchanged name closes without a request.
 */

import React, { useRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { SPACE } from '../../theme/theme';
import { BottomSheet, Button, TextField } from '../design';
import { useAuth } from '../../hooks/useAuth';
import UserService from '../../services/UserService';
import { showToast } from '../../utils/toast';

/** The backend keeps names short; the field stops here. */
export const NAME_MAX_LENGTH = 50;

export interface NameEditSheetProps {
  visible: boolean;
  onClose: () => void;
  testID?: string;
}

export const NameEditSheet: React.FC<NameEditSheetProps> = observer(({ visible, onClose, testID }) => {
  const { t } = useTranslation('profile');
  const authStore = useAuth();
  const current = authStore.backendUser?.firstName?.trim() ?? '';

  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const input = useRef<TextInput>(null);

  // Every opening starts from the name the account has now. Read at the
  // opening only: a user update that lands while the sheet is open never
  // overwrites what is being typed.
  const [shownVisible, setShownVisible] = useState(visible);
  if (shownVisible !== visible) {
    setShownVisible(visible);
    if (visible) setName(current);
  }

  const trimmed = name.trim();

  const handleSave = async () => {
    if (!trimmed || saving) return;
    if (trimmed === current) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const user = await UserService.updateProfile({ firstName: trimmed });
      authStore.updateBackendUser(user);
      showToast.success(t('name.saved'));
      onClose();
    } catch (err) {
      console.warn('Name update failed:', err);
      showToast.error(t('name.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('name.title')}
      scrollable
      onOpened={() => input.current?.focus()}
      testID={testID}
    >
      <TextField
        ref={input}
        label={t('name.label')}
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX_LENGTH}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void handleSave()}
        editable={!saving}
        testID="profile-name-input"
      />
      <Button
        label={t('name.save')}
        block
        disabled={!trimmed}
        loading={saving}
        onPress={() => void handleSave()}
        style={styles.save}
        testID="profile-name-save"
      />
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  // Form rhythm: the last field to the submit (no colours, so one sheet for every palette).
  save: { marginTop: SPACE.xl },
});

export default NameEditSheet;
