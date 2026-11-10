/**
 * Cartesia Sonic 3 emotion vocabulary.
 *
 * Sonic 3 accepts a single emotion string per generation (different from
 * Sonic 2's __experimental_controls array). Primary emotions are the ones
 * Cartesia documents as having the most training data; the extended list
 * is everything the API will accept.
 *
 * Source: https://docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion
 */

export const SONIC3_PRIMARY_EMOTIONS = [
  'neutral',
  'angry',
  'excited',
  'content',
  'sad',
  'scared',
] as const;

export type Sonic3PrimaryEmotion = typeof SONIC3_PRIMARY_EMOTIONS[number];

export const SONIC3_EXTENDED_EMOTIONS = [
  ...SONIC3_PRIMARY_EMOTIONS,
  'happy',
  'enthusiastic',
  'elated',
  'euphoric',
  'triumphant',
  'amazed',
  'surprised',
  'flirtatious',
  'joking',
  'curious',
  'peaceful',
  'serene',
  'calm',
  'grateful',
  'affectionate',
  'trust',
  'sympathetic',
  'anticipation',
  'mysterious',
  'mad',
  'outraged',
  'frustrated',
  'agitated',
  'threatened',
  'disgusted',
  'contempt',
  'envious',
  'sarcastic',
  'ironic',
  'dejected',
  'melancholic',
  'disappointed',
  'hurt',
  'guilty',
  'bored',
  'tired',
  'rejected',
  'nostalgic',
  'wistful',
  'apologetic',
  'hesitant',
  'insecure',
  'confused',
  'resigned',
  'anxious',
  'panicked',
  'alarmed',
  'proud',
  'confident',
  'distant',
  'skeptical',
  'contemplative',
  'determined',
] as const;

export type Sonic3Emotion = typeof SONIC3_EXTENDED_EMOTIONS[number];

/**
 * The child-safe subset the segmentation prompt asks for and the admin
 * segment editor and the import recommend. Any extended emotion is still
 * accepted (an editor may pick one on purpose).
 */
export const SONIC3_BEDTIME_EMOTIONS: readonly Sonic3Emotion[] = [
  'neutral',
  'peaceful',
  'calm',
  'content',
  'curious',
  'mysterious',
  'nostalgic',
  'happy',
  'excited',
  'sad',
  'scared',
];

/**
 * Turkish names of the emotions, shown in the admin panel (settings page,
 * story defaults, segment editor). Typed by the emotion list, so a new
 * emotion without a label does not compile.
 */
export const SONIC3_EMOTION_LABELS_TR: Record<Sonic3Emotion, string> = {
  neutral: 'Nötr',
  angry: 'Sinirli',
  excited: 'Heyecanlı',
  content: 'Memnun',
  sad: 'Üzgün',
  scared: 'Korkmuş',
  happy: 'Mutlu',
  enthusiastic: 'Coşkulu',
  elated: 'Sevinçli',
  euphoric: 'Aşırı mutlu',
  triumphant: 'Muzaffer',
  amazed: 'Hayran kalmış',
  surprised: 'Şaşkın',
  flirtatious: 'Cilveli',
  joking: 'Şakacı',
  curious: 'Meraklı',
  peaceful: 'Huzurlu',
  serene: 'Dingin',
  calm: 'Sakin',
  grateful: 'Minnettar',
  affectionate: 'Şefkatli',
  trust: 'Güven dolu',
  sympathetic: 'Anlayışlı',
  anticipation: 'Beklenti dolu',
  mysterious: 'Gizemli',
  mad: 'Çılgına dönmüş',
  outraged: 'Öfkeli',
  frustrated: 'Engellenmiş',
  agitated: 'Tedirgin',
  threatened: 'Tehdit altında',
  disgusted: 'İğrenmiş',
  contempt: 'Küçümseyen',
  envious: 'Kıskanç',
  sarcastic: 'Alaycı',
  ironic: 'İronik',
  dejected: 'Bunalmış',
  melancholic: 'Melankolik',
  disappointed: 'Hayal kırıklığına uğramış',
  hurt: 'İncinmiş',
  guilty: 'Suçlu hisseden',
  bored: 'Sıkılmış',
  tired: 'Yorgun',
  rejected: 'Reddedilmiş',
  nostalgic: 'Nostaljik',
  wistful: 'Hasret dolu',
  apologetic: 'Özür dileyen',
  hesitant: 'Tereddütlü',
  insecure: 'Güvensiz',
  confused: 'Kafası karışık',
  resigned: 'Kabullenmiş',
  anxious: 'Endişeli',
  panicked: 'Panik içinde',
  alarmed: 'Telaşlı',
  proud: 'Gururlu',
  confident: 'Kendinden emin',
  distant: 'Mesafeli',
  skeptical: 'Şüpheci',
  contemplative: 'Düşünceli',
  determined: 'Kararlı',
};


export function isValidSonic3Emotion(value: unknown): value is Sonic3Emotion {
  return (
    typeof value === 'string' &&
    (SONIC3_EXTENDED_EMOTIONS as readonly string[]).includes(value)
  );
}

export const SONIC3_DEFAULT_EMOTION: Sonic3PrimaryEmotion = 'neutral';

/**
 * Hard limits on Cartesia generation_config numeric fields.
 * Out-of-range values get rejected with HTTP 400 by the API.
 */
export const SONIC3_SPEED_MIN = 0.6;
export const SONIC3_SPEED_MAX = 1.5;
export const SONIC3_VOLUME_MIN = 0.5;
export const SONIC3_VOLUME_MAX = 2.0;
