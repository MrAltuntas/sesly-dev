/**
 * useMiniPlayerInset: the list padding a tab screen adds for the mini
 * player. 0 while the store hides it, the dock height plus 8 while it shows,
 * following the store live in a component that is not an observer.
 */

import React from 'react';
import { observable, runInAction } from 'mobx';
import { act, renderHook } from '@testing-library/react-native';

const mockAudio = observable({ showMiniPlayer: false, isPlaying: false });
jest.mock('../../hooks/useAudioPlayer', () => ({ useAudioPlayer: () => mockAudio }));

import { ThemeProvider } from '../../theme/ThemeProvider';
import { SPACE } from '../../theme/theme';
import { MINI_PLAYER_DOCK_HEIGHT } from '../design/MiniPlayerBar';
import { useMiniPlayerInset } from './useMiniPlayerInset';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ThemeProvider, { initialPalette: 'gece-mavisi', children });

function setShown(shown: boolean): void {
  act(() => {
    runInAction(() => {
      mockAudio.showMiniPlayer = shown;
    });
  });
}

beforeEach(() => {
  runInAction(() => {
    mockAudio.showMiniPlayer = false;
    mockAudio.isPlaying = false;
  });
});

describe('useMiniPlayerInset', () => {
  it('is 0 while the mini player is hidden', () => {
    const { result } = renderHook(() => useMiniPlayerInset(), { wrapper });
    expect(result.current).toBe(0);
  });

  it('is the dock height plus 8 (75) while it shows', () => {
    setShown(true);
    const { result } = renderHook(() => useMiniPlayerInset(), { wrapper });
    expect(result.current).toBe(MINI_PLAYER_DOCK_HEIGHT + SPACE.sm);
    expect(result.current).toBe(67 + 8);
  });

  it('follows the store both ways without the screen being an observer', () => {
    const { result } = renderHook(() => useMiniPlayerInset(), { wrapper });
    expect(result.current).toBe(0);
    setShown(true);
    expect(result.current).toBe(75);
    setShown(false);
    expect(result.current).toBe(0);
  });

  it('a screen does not re-render for other store fields', () => {
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useMiniPlayerInset();
      },
      { wrapper },
    );
    const before = renders;
    act(() => {
      runInAction(() => {
        mockAudio.isPlaying = true;
      });
    });
    expect(renders).toBe(before);
  });

  it('stops following the store once unmounted', () => {
    const { result, unmount } = renderHook(() => useMiniPlayerInset(), { wrapper });
    unmount();
    setShown(true);
    expect(result.current).toBe(0);
  });
});
