// Mirror of sesly-backend/src/modules/tts-providers/cartesia/cartesia-emotions.constants.ts
// Keep in sync when the backend list changes. Used by the SegmentEditor +
// CartesiaSettings dropdowns so admins can only pick API-accepted values.

export const SONIC3_PRIMARY_EMOTIONS = [
    "neutral",
    "angry",
    "excited",
    "content",
    "sad",
    "scared",
] as const;

export type Sonic3PrimaryEmotion = typeof SONIC3_PRIMARY_EMOTIONS[number];

export const SONIC3_EXTENDED_EMOTIONS = [
    ...SONIC3_PRIMARY_EMOTIONS,
    "happy",
    "enthusiastic",
    "elated",
    "euphoric",
    "triumphant",
    "amazed",
    "surprised",
    "flirtatious",
    "joking",
    "curious",
    "peaceful",
    "serene",
    "calm",
    "grateful",
    "affectionate",
    "trust",
    "sympathetic",
    "anticipation",
    "mysterious",
    "mad",
    "outraged",
    "frustrated",
    "agitated",
    "threatened",
    "disgusted",
    "contempt",
    "envious",
    "sarcastic",
    "ironic",
    "dejected",
    "melancholic",
    "disappointed",
    "hurt",
    "guilty",
    "bored",
    "tired",
    "rejected",
    "nostalgic",
    "wistful",
    "apologetic",
    "hesitant",
    "insecure",
    "confused",
    "resigned",
    "anxious",
    "panicked",
    "alarmed",
    "proud",
    "confident",
    "distant",
    "skeptical",
    "contemplative",
    "determined",
] as const;

export type Sonic3Emotion = typeof SONIC3_EXTENDED_EMOTIONS[number];

export const SONIC3_DEFAULT_EMOTION: Sonic3PrimaryEmotion = "neutral";

export const SONIC3_SPEED_MIN = 0.6;
export const SONIC3_SPEED_MAX = 1.5;
export const SONIC3_SPEED_STEP = 0.05;
export const SONIC3_DEFAULT_SPEED = 0.85;

export const SONIC3_VOLUME_MIN = 0.5;
export const SONIC3_VOLUME_MAX = 2.0;
export const SONIC3_VOLUME_STEP = 0.05;
export const SONIC3_DEFAULT_VOLUME = 1.0;

// Turkish labels for every Cartesia Sonic 3 emotion. Type is the full
// Record (not Partial) so adding a new value to SONIC3_EXTENDED_EMOTIONS
// without a translation becomes a TS error instead of leaking English
// into the admin dropdown. Same names as SONIC3_EMOTION_LABELS_TR in the
// backend (cartesia-emotions.constants.ts), which the settings page shows.
export const SONIC3_EMOTION_LABELS_TR: Record<Sonic3Emotion, string> = {
    // Primary
    neutral: "Nötr",
    angry: "Sinirli",
    excited: "Heyecanlı",
    content: "Memnun",
    sad: "Üzgün",
    scared: "Korkmuş",
    // Happy, elated
    happy: "Mutlu",
    enthusiastic: "Coşkulu",
    elated: "Sevinçli",
    euphoric: "Aşırı mutlu",
    triumphant: "Muzaffer",
    amazed: "Hayran kalmış",
    surprised: "Şaşkın",
    flirtatious: "Cilveli",
    joking: "Şakacı",
    // Calm, peaceful
    curious: "Meraklı",
    peaceful: "Huzurlu",
    serene: "Dingin",
    calm: "Sakin",
    grateful: "Minnettar",
    affectionate: "Şefkatli",
    trust: "Güven dolu",
    sympathetic: "Anlayışlı",
    anticipation: "Beklenti dolu",
    mysterious: "Gizemli",
    // Anger
    mad: "Çılgına dönmüş",
    outraged: "Öfkeli",
    frustrated: "Engellenmiş",
    agitated: "Tedirgin",
    threatened: "Tehdit altında",
    disgusted: "İğrenmiş",
    contempt: "Küçümseyen",
    envious: "Kıskanç",
    sarcastic: "Alaycı",
    ironic: "İronik",
    // Sadness, weariness
    dejected: "Bunalmış",
    melancholic: "Melankolik",
    disappointed: "Hayal kırıklığına uğramış",
    hurt: "İncinmiş",
    guilty: "Suçlu hisseden",
    bored: "Sıkılmış",
    tired: "Yorgun",
    rejected: "Reddedilmiş",
    nostalgic: "Nostaljik",
    wistful: "Hasret dolu",
    // Hesitation, worry
    apologetic: "Özür dileyen",
    hesitant: "Tereddütlü",
    insecure: "Güvensiz",
    confused: "Kafası karışık",
    resigned: "Kabullenmiş",
    anxious: "Endişeli",
    panicked: "Panik içinde",
    alarmed: "Telaşlı",
    // Confidence, resolve
    proud: "Gururlu",
    confident: "Kendinden emin",
    distant: "Mesafeli",
    skeptical: "Şüpheci",
    contemplative: "Düşünceli",
    determined: "Kararlı",
};

export function emotionLabel(value: string): string {
    return SONIC3_EMOTION_LABELS_TR[value as Sonic3Emotion] ?? value;
}
