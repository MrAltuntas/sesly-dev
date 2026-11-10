import { renderCartesiaTranscript } from './cartesia-transcript';

describe('renderCartesiaTranscript', () => {
  it('one part at the request speed is the text itself', () => {
    expect(renderCartesiaTranscript([{ text: 'Bir varmış.', speed: 0.85 }], 0.85)).toBe('Bir varmış.');
  });

  it('switches speed with an inline tag only when it changes, adds breaks after parts', () => {
    expect(
      renderCartesiaTranscript(
        [
          { text: 'Bir.', speed: 0.8 },
          { text: 'Iki.', speed: 0.8, pauseAfterMs: 600 },
          { text: 'Uc.', speed: 1.05 },
          { text: 'Dort.' },
          { text: 'Bes.', pauseAfterMs: 9000 },
        ],
        0.8,
      ),
    ).toBe(
      'Bir. Iki.<break time="600ms"/> <speed ratio="1.05"/> Uc. <speed ratio="0.8"/> Dort. Bes.<break time="3000ms"/>',
    );
  });

  it('clamps speeds into the Sonic 3 range and keeps the whitespace of the parts', () => {
    expect(renderCartesiaTranscript([{ text: 'a ' }, { text: 'b', speed: 3 }], 0.85)).toBe('a <speed ratio="1.5"/> b');
  });

  it('a "<" in the story cannot open a tag', () => {
    expect(renderCartesiaTranscript([{ text: 'a <break time="9s"/> b' }], 1)).toBe('a ‹break time="9s"/> b');
  });
});
