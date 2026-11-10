/**
 * SeslySystemBars: the zero-size view a Modal mounts as its first child so
 * the navigation bar of the Modal's own window stays transparent, without
 * the contrast scrim (Android only, docs/release-pass/SPEC-design.md 2.1).
 *
 * `getModalSystemBars()` is `null` on iOS and web: the module has no iOS
 * side, so the native view is never asked for there. It is also `null` in a
 * build made before the module existed (a stale dev client), where the view
 * would only be an unimplemented placeholder. On Android it is resolved once,
 * on the first call (`requireNativeViewManager`, which the `expo` package
 * re-exports as `requireNativeView`).
 */

import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export type ModalSystemBarsProps = ViewProps;

let cached: ComponentType<ModalSystemBarsProps> | null | undefined;

export function getModalSystemBars(): ComponentType<ModalSystemBarsProps> | null {
  if (Platform.OS !== 'android') return null;
  // Resolved on the first Android call only: nothing touches the native
  // view registry on iOS.
  if (cached === undefined) {
    cached = requireOptionalNativeModule('SeslySystemBars')
      ? requireNativeViewManager<ModalSystemBarsProps>('SeslySystemBars')
      : null;
  }
  return cached;
}
