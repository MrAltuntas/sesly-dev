/**
 * Navigation ref for imperative access outside React (push-notification
 * routing, services). Lives in its own module so non-screen code can import
 * it without pulling in (and cycling through) RootNavigator.
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
