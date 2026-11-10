/**
 * Content shown inside the phone mockups. Every string is the app's own
 * (sesly-mobile/src/i18n/<lang>/*.json) or real catalogue data
 * (stories/batch1/import-batch1.json: titles, categories, age groups, how the
 * text was made). The user names (Elif, Emma) and the own voice name (Annem,
 * Mum) are sample data; Aoede and Kore are ready-made Chirp 3 HD narrators.
 */

export type MockLang = 'tr' | 'en';
export type CatSlot = 'uyku' | 'turk' | 'dunya' | 'egitici';

export interface MockStory {
  key: string;
  title: string;
  minutes: string;
}

export interface MockCopy {
  greet: string;
  initial: string;
  heroTag: string;
  hero: { key: string; title: string; minutes: string; age: string };
  tabs: [string, string, string, string];
  tiles: [string, string, string, string];
  seeAll: string;
  shelves: { slot: CatSlot; title: string; items: MockStory[] }[];
  story: {
    key: string;
    title: string;
    category: string;
    shelf: string;
    tags: string[];
    summary: string;
    /** The app's MachineTranslationNote, when this language version was translated with AI. */
    machineNote?: string;
  };
  cardsTitle: string;
  own: [string, string];
  ready: string;
  narrators: [string, string];
  ctaOwn: string;
  nowPlaying: string;
  narratedBy: string;
  timerLeft: string;
  timerModeLabel: string;
  timerModes: [string, string];
  timerFade: string;
  timerValue: string;
  speed: string;
  speedValue: string;
  elapsed: string;
  remaining: string;
}

export const MOCK: Record<MockLang, MockCopy> = {
  tr: {
    greet: 'İyi geceler, Elif',
    initial: 'E',
    heroTag: 'Bu gecenin masalı',
    hero: { key: 'goodnight-tinku', title: 'İyi Geceler, Tinku', minutes: '3 dk', age: '3-6 yaş' },
    tabs: ['Masallar', 'Keşfet', 'Kütüphane', 'Sesim'],
    tiles: ['Uyku masalları', 'Türk masalları', 'Dünya klasikleri', 'Öğretici masallar'],
    seeAll: 'Tümü',
    shelves: [
      {
        slot: 'uyku',
        title: 'Uyku masalları',
        items: [
          { key: 'sindi-and-the-moon', title: 'Sindi ile Ay', minutes: '4 dk' },
          { key: 'frogs-starry-wish', title: 'Kurbağanın Yıldız Dileği', minutes: '2 dk' },
          { key: 'ramyas-stars', title: "Ramya'nın Yıldızları", minutes: '3 dk' },
          { key: 'the-dream-pillow', title: 'Rüya Yastığı', minutes: '2 dk' },
        ],
      },
      {
        slot: 'turk',
        title: 'Türk masalları',
        items: [
          { key: 'kunos-kabak-kiz', title: 'Kabak Kız', minutes: '7 dk' },
          { key: 'kunos-kel-oglan', title: 'Kel Oğlan', minutes: '9 dk' },
          { key: 'kunos-kara-inek-masali', title: 'Kara İnek Masalı', minutes: '10 dk' },
        ],
      },
      {
        slot: 'dunya',
        title: 'Dünya klasikleri',
        items: [
          { key: 'puss-in-boots', title: 'Çizmeli Kedi', minutes: '16 dk' },
          { key: 'the-flying-ship', title: 'Uçan Gemi', minutes: '15 dk' },
          { key: 'little-red-riding-hood', title: 'Kırmızı Başlıklı Kız', minutes: '8 dk' },
        ],
      },
    ],
    story: {
      key: 'sindi-and-the-moon',
      title: 'Sindi ile Ay',
      category: 'Uyku masalı',
      shelf: 'Uyku masalları',
      tags: ['3-6 yaş', '4 dk', 'Türkçe'],
      summary: 'Sindi okulun ilk gününden biraz çekinmektedir, ama ay ve yıldızlar onu huzurla uyutur.',
      machineNote: 'Bu metin İngilizce aslından yapay zekâ ile çevrildi.',
    },
    cardsTitle: 'Kimin sesiyle dinlesin?',
    own: ['Annem', 'Kendi sesin'],
    ready: 'Hazır anlatıcı',
    narrators: ['Aoede', 'Kore'],
    ctaOwn: 'Senin sesinle dinle',
    nowPlaying: 'Şimdi dinleniyor',
    narratedBy: 'Annem anlatıyor',
    timerLeft: 'Kalan süre',
    timerModeLabel: 'Ne zaman dursun',
    timerModes: ['Masal bitince', 'Süre dolunca'],
    timerFade: 'Son bir dakikada sesi yavaşça kıs',
    timerValue: '14:52',
    speed: 'Hız',
    speedValue: '0,9x',
    elapsed: '1:42',
    remaining: '-2:18',
  },
  en: {
    greet: 'Good night, Emma',
    initial: 'E',
    heroTag: "Tonight's story",
    hero: { key: 'goodnight-tinku', title: 'Goodnight, Tinku!', minutes: '4 min', age: 'Ages 3-6' },
    tabs: ['Stories', 'Discover', 'Library', 'My voice'],
    tiles: ['Bedtime stories', 'Turkish tales', 'World classics', 'Educational stories'],
    seeAll: 'See all',
    shelves: [
      {
        slot: 'uyku',
        title: 'Bedtime stories',
        items: [
          { key: 'sindi-and-the-moon', title: 'Sindi and the Moon', minutes: '6 min' },
          { key: 'frogs-starry-wish', title: "Frog's Starry Wish", minutes: '2 min' },
          { key: 'ramyas-stars', title: "Ramya's Stars", minutes: '3 min' },
          { key: 'the-dream-pillow', title: 'The Dream Pillow', minutes: '2 min' },
        ],
      },
      {
        slot: 'dunya',
        title: 'World classics',
        items: [
          { key: 'puss-in-boots', title: 'Puss in Boots', minutes: '23 min' },
          { key: 'the-flying-ship', title: 'The Flying Ship', minutes: '22 min' },
          { key: 'little-red-riding-hood', title: 'Little Red Riding-Hood', minutes: '12 min' },
        ],
      },
      {
        slot: 'turk',
        title: 'Turkish tales',
        items: [
          { key: 'kunos-kabak-kiz', title: 'Kabak Kız', minutes: '7 min' },
          { key: 'kunos-kel-oglan', title: 'Kel Oğlan', minutes: '9 min' },
          { key: 'kunos-kara-inek-masali', title: 'Kara İnek Masalı', minutes: '10 min' },
        ],
      },
    ],
    story: {
      key: 'sindi-and-the-moon',
      title: 'Sindi and the Moon',
      category: 'Bedtime story',
      shelf: 'Bedtime stories',
      tags: ['Ages 3-6', '6 min', 'English'],
      summary: 'Sindi is nervous about her first day at school, but the moon and the stars help her fall asleep.',
    },
    cardsTitle: 'Whose voice should read it?',
    own: ['Mum', 'Your voice'],
    ready: 'Ready-made',
    narrators: ['Aoede', 'Kore'],
    ctaOwn: 'Listen in your voice',
    nowPlaying: 'Now playing',
    narratedBy: 'Narrated by Mum',
    timerLeft: 'Time left',
    timerModeLabel: 'When to stop',
    timerModes: ['End of story', 'After a time'],
    timerFade: 'Fade the sound out over the last minute',
    timerValue: '14:52',
    speed: 'Speed',
    speedValue: '0.9x',
    elapsed: '1:42',
    remaining: '-2:18',
  },
};

export const coverSrc = (key: string, width: 240 | 480) => `/covers/${key}-${width}.webp`;
