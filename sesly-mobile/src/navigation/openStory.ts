/**
 * Opening a story page without stacking a copy of the one just left.
 *
 * StoryDetail, then "Dinle", then the player's title (or a push tap about the
 * same story) used to push a second StoryDetail of the same story above the
 * player; back then led to the player and to the same page again. When the
 * route directly below the focused one is that story's page, going back is
 * the same destination with the state (scroll, narrator choice) kept.
 * Anything else navigates as before.
 */

import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

interface StackStateLike {
  readonly index: number;
  readonly routes: ReadonlyArray<{ readonly name: string; readonly params?: object }>;
}

/** A root stack navigation object (or the container ref). */
export interface StoryNavigation {
  navigate: NavigationProp<RootStackParamList>['navigate'];
  goBack(): void;
  getState(): StackStateLike | undefined;
}

/** True when the route under the focused one is StoryDetail of `storyId`. */
export function isStoryBelow(state: StackStateLike | undefined, storyId: string): boolean {
  if (!state || state.index < 1) return false;
  const below = state.routes[state.index - 1];
  if (!below || below.name !== 'StoryDetail') return false;
  const params = (below.params ?? {}) as { storyId?: unknown };
  return params.storyId === storyId;
}

export function openStoryDetail(nav: StoryNavigation, storyId: string): void {
  if (isStoryBelow(nav.getState(), storyId)) {
    nav.goBack();
    return;
  }
  nav.navigate('StoryDetail', { storyId });
}
