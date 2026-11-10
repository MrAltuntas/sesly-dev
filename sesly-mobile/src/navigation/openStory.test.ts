/**
 * openStoryDetail: StoryDetail, then the player, then the story again goes
 * back to the page below instead of stacking a copy of it.
 */

import { isStoryBelow, openStoryDetail, type StoryNavigation } from './openStory';

type Routes = { name: string; params?: object }[];

function makeNav(routes: Routes, index = routes.length - 1) {
  const nav = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    getState: jest.fn(() => ({ index, routes })),
  };
  return nav as typeof nav & StoryNavigation;
}

const MAIN = { name: 'Main' };
const story = (storyId: string) => ({ name: 'StoryDetail', params: { storyId } });
const player = { name: 'AudioPlayer', params: { narrationId: 'nar-1' } };

describe('openStoryDetail', () => {
  it('goes back when the same story is directly below', () => {
    const nav = makeNav([MAIN, story('s-1'), player]);

    openStoryDetail(nav, 's-1');

    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('pushes when the story below is a different one', () => {
    const nav = makeNav([MAIN, story('s-1'), player]);

    openStoryDetail(nav, 's-2');

    expect(nav.goBack).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
  });

  it('pushes when the story is further down, not directly below', () => {
    const nav = makeNav([MAIN, story('s-1'), player, { name: 'Profile' }]);

    openStoryDetail(nav, 's-1');

    expect(nav.goBack).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1' });
  });

  it('pushes from the root route and when the navigator has no state yet', () => {
    const root = makeNav([MAIN]);
    openStoryDetail(root, 's-1');
    expect(root.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1' });

    const empty = makeNav([]);
    empty.getState.mockReturnValue(undefined as unknown as { index: number; routes: Routes });
    openStoryDetail(empty, 's-1');
    expect(empty.goBack).not.toHaveBeenCalled();
    expect(empty.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1' });
  });

  it('reads the focused index, not the top of the routes array', () => {
    // A preloaded or retained route above the focused one must not count.
    const nav = makeNav([MAIN, story('s-1'), player, story('s-9')], 2);

    openStoryDetail(nav, 's-1');

    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });
});

describe('isStoryBelow', () => {
  it('needs a StoryDetail route with that exact storyId', () => {
    expect(isStoryBelow({ index: 1, routes: [story('s-1'), player] }, 's-1')).toBe(true);
    expect(isStoryBelow({ index: 1, routes: [{ name: 'StoryDetail' }, player] }, 's-1')).toBe(false);
    expect(isStoryBelow({ index: 1, routes: [{ name: 'AllStories', params: { storyId: 's-1' } }, player] }, 's-1')).toBe(false);
    expect(isStoryBelow({ index: 0, routes: [story('s-1')] }, 's-1')).toBe(false);
    expect(isStoryBelow(undefined, 's-1')).toBe(false);
  });
});
