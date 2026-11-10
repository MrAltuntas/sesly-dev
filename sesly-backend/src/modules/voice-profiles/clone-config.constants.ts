/**
 * Voice clone recording + consent configuration, served verbatim by
 * GET /voice-profiles/clone-config so the mobile recorder, the consent screen
 * and the server-side checks share one source of truth.
 *
 * Timing (Cartesia Sonic 3.6+ learns from up to 60 s of reference audio;
 * 10 s is the provider minimum):
 *   - minSeconds    client gate: at least this much speech before upload
 *   - targetSeconds what the UI encourages
 *   - maxSeconds    hard cap (the server also trims the clip to this length)
 * The server rejects clips shorter than CLONE_SERVER_MIN_SECONDS after
 * leading-silence trimming.
 */
import {
  DEFAULT_VOICE_LANGUAGE,
  VOICE_LANGUAGES,
  VoiceLanguage,
  VoiceLanguageCode,
  findVoiceLanguage,
} from '../../common/constants/voice-languages';

export const CLONE_PROVIDER = 'CARTESIA' as const;
/** Language served when a request names none (every app build before the language choice). */
export const CLONE_LANGUAGE = DEFAULT_VOICE_LANGUAGE;
export const CLONE_MIN_SECONDS = 15;
export const CLONE_TARGET_SECONDS = 30;
export const CLONE_MAX_SECONDS = 60;
export const CLONE_SERVER_MIN_SECONDS = 10;

/**
 * Consent version of the Turkish text. Bump whenever CLONE_CONSENT_TEXT
 * changes in substance. Every language has its own version id (see
 * CLONE_LANGUAGE_CONTENT): the upload must carry the version of the text the
 * user was actually shown. The version is stored on the profile
 * (`voice_profiles.consentVersion`) when the upload is accepted and checked
 * only then: an existing clone keeps the version it was made with, and a
 * client holding an older text gets 400 CONSENT_REQUIRED (with the current
 * version), refetches the clone config and asks for consent again.
 *
 * History:
 *   2026-09-v1  first text
 *   2026-10-v2  contact address for KVKK rights is info@sesly.io (was destek@sesly.app)
 */
export const CLONE_CONSENT_VERSION = '2026-10-v2';

export const CLONE_SCRIPT_TITLE = 'Yıldızlı Bir Gece';

/**
 * Original calm bedtime passage (about 125 words, 45-55 s read slowly).
 * Phonetically varied for Turkish (ç ğ ı İ ö ş ü, long vowels in "rüzgâr",
 * "kâğıt", "hâlâ"), no dialogue, no digits, ends on a full sentence.
 * The clone picks up the mood of the clip, so the text is intentionally soft.
 */
export const CLONE_SCRIPT = [
  'Akşam olunca köyün üstüne yumuşak bir sessizlik çöker. Gökyüzü önce pembeye, sonra koyu maviye döner. Küçük Ilgın penceresinin önüne oturur ve ilk yıldızın doğmasını sabırla bekler. Bahçedeki ağaçların yaprakları rüzgârla fısıldaşır, uzaklardan bir baykuşun sesi duyulur.',
  'Annesi ona ılık bir süt getirir ve battaniyesini omuzlarına örter. Masanın üstünde, dün katladığı kâğıttan gemi hâlâ duruyor. Ilgın gözlerini kapatır, derin ve sakin bir nefes alır. Şimdi gün boyunca gördüğü güzel şeyleri düşünür. Çiçeklerin üstünde dans eden kelebekleri, derenin neşeli şırıltısını, arkadaşlarıyla paylaştığı sıcacık çörekleri hatırlar.',
  'Ay yavaşça yükselir ve odayı gümüş bir ışıkla doldurur. Her şey yerli yerindedir, her şey güvendedir. Annesi yanağına bir öpücük kondurur, ışığı kısar ve kapıyı aralık bırakır. Uyku, bir tüy kadar hafif, usulca gelir. İyi geceler, küçük yıldızım. Tatlı rüyalar seni bekliyor.',
].join('\n\n');

export const CLONE_CONSENT_TITLE = 'Sesin için açık rıza';

/**
 * KVKK explicit consent (açık rıza) text shown before recording.
 *
 * TODO(legal): NEEDS LEGAL REVIEW before a public launch. Drafted by
 * engineering from the actual data flow; a KVKK lawyer should confirm the
 * wording, the cross-border transfer basis and the controller details.
 * Keep it in sync with the privacy policy (legal-documents/content/privacy.tr.md).
 */
export const CLONE_CONSENT_TEXT = [
  'Sesly, masalları senin sesinle anlatabilmek için ses kaydından sesinin yapay bir kopyasını (ses modeli) oluşturur. Devam etmeden önce lütfen aşağıdaki bilgileri oku.',
  'Ses kaydın ve ondan oluşturulan ses modeli, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında biyometrik veri, yani özel nitelikli kişisel veri olarak kabul edilir. Bu verileri yalnızca açık rızanla işleriz.',
  'Amaç: Kaydın yalnızca sesinin yapay bir kopyasını oluşturmak ve bu sesle kendi ailen için masal seslendirmek amacıyla kullanılır. Sesly, kaydını ve ses modelini reklam ya da pazarlama amacıyla kullanmaz ve üçüncü kişilere satmaz.',
  "Yurt dışına aktarım: Ses modeli, veri işleyenimiz Cartesia, Inc. tarafından Amerika Birleşik Devletleri'nde oluşturulur ve saklanır. Masallar da bu sağlayıcı üzerinden seslendirilir. Bu nedenle ses kaydın ve ses modelin yurt dışına aktarılır.",
  "Saklama süresi: Ham ses kaydın ve ses modelin, ses profilini ya da hesabını silene kadar saklanır. Sildiğinde kayıt ve model hem bizim depolama alanımızdan hem de Cartesia'dan silinir.",
  'Yalnızca kendi sesin: Bu özellikle yalnızca kendi sesini kaydetmelisin. Başka birinin sesini kaydetmek yasaktır.',
  "Rızanı geri alma: Açık rızanı dilediğin zaman geri alabilirsin. Bunun için uygulamada ilgili ses profilini silmen yeterlidir. Hesabını silmek de tüm ses kayıtlarını ve ses modellerini siler. KVKK kapsamındaki diğer hakların için info@sesly.io adresine yazabilirsin.",
  'Onayladığında, ses kaydının yukarıda açıklanan şekilde işlenmesine ve yurt dışına aktarılmasına açık rıza vermiş olursun.',
].join('\n\n');

/** One numbered step of the clone intro screen (CreateVoiceProfileScreen). */
export interface CloneIntroStep {
  title: string;
  body: string;
}

/**
 * Icon keys of the recording tips. Mobile maps each key to its own icon set
 * (Ionicons) and ignores keys it does not know, so a new key is additive.
 */
export type CloneRecordingTipIcon = 'quiet' | 'distance' | 'calm' | 'pauses';

export interface CloneRecordingTip {
  icon: CloneRecordingTipIcon;
  text: string;
}

/**
 * Intro steps, numbered by position. The durations come from the constants
 * above so the copy can never disagree with the recorder gates.
 */
export const CLONE_INTRO_STEPS: readonly CloneIntroStep[] = [
  {
    title: 'Sessiz bir oda bul',
    body: 'Çevren ne kadar sessiz olursa Sesly sesini o kadar temiz öğrenir.',
  },
  {
    title: `Yaklaşık ${CLONE_TARGET_SECONDS} saniyelik bir masal oku`,
    body: `Sana kısa bir masal metni göstereceğiz. En az ${CLONE_MIN_SECONDS} saniye okuman gerekiyor; daha uzun kayıt aksanını daha iyi korur.`,
  },
  {
    title: 'Sesin hazırlansın',
    body: 'Kaydın genellikle bir dakikadan kısa sürede hazır olur. Beklemek zorunda değilsin, hazır olunca haber veririz.',
  },
];

/** Guidance shown on the recording screen (VoiceRecordingScreen). */
export const CLONE_RECORDING_TIPS: readonly CloneRecordingTip[] = [
  { icon: 'quiet', text: 'Sessiz bir odada kaydet.' },
  { icon: 'distance', text: 'Telefonu ağzından bir karış uzakta tut.' },
  { icon: 'calm', text: 'Masal okur gibi doğal ve sakin oku.' },
  { icon: 'pauses', text: 'Uzun duraklama yapma, akıcı bir şekilde devam et.' },
];

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

export const CLONE_SCRIPT_TITLE_EN = 'A Starry Night';

/**
 * Original calm bedtime passage, the English counterpart of CLONE_SCRIPT:
 * same scene and mood, about 150 words (50 to 55 s read slowly; English
 * needs more words than Turkish for the same time). Phonetically varied
 * (th, sh, ch, j, zh in "treasure", ng, r, l, w, v, z, long and short
 * vowels, diphthongs), no dialogue, no digits, ends on a full sentence.
 */
export const CLONE_SCRIPT_EN = [
  'When evening comes, a soft hush settles over the village. The sky turns pink, then a deep and quiet blue. Little Juniper sits by her window and waits for the first star. Leaves whisper in the garden, and far away an owl calls through the dark.',
  'Her mother brings a cup of warm milk and tucks a blanket around her shoulders. The paper boat she folded yesterday still waits on the table. Juniper closes her eyes and takes a slow, deep breath. She thinks of butterflies above the flowers, the cheerful splash of the brook, and the sweet buns she shared with friends.',
  'The moon rises slowly and fills the room with silver light. Everything is in its place, and everything is safe. Her mother kisses her cheek and dims the lamp. Sleep arrives as gently as a feather. Good night, my little treasure. Sweet dreams are waiting for you.',
].join('\n\n');

/**
 * Bump whenever CLONE_CONSENT_TEXT_EN changes in substance (see
 * CLONE_CONSENT_VERSION for how the version is stored and checked).
 *
 * History:
 *   2026-10-en-v1  first text
 *   2026-10-en-v2  contact address for KVKK rights is info@sesly.io (was destek@sesly.app)
 */
export const CLONE_CONSENT_VERSION_EN = '2026-10-en-v2';

export const CLONE_CONSENT_TITLE_EN = 'Explicit consent for your voice';

/**
 * English version of the KVKK explicit consent text.
 *
 * TODO(legal): NEEDS LEGAL REVIEW BEFORE ENGLISH CLONING IS OFFERED TO REAL
 * USERS. This is a faithful, paragraph by paragraph translation of
 * CLONE_CONSENT_TEXT made by engineering, not by a lawyer or a sworn
 * translator. Nobody has confirmed that the English wording carries the same
 * legal meaning as the Turkish one, nor whether a user who consents in
 * English needs anything beyond KVKK (for example GDPR wording for a user in
 * the EU). Until it is reviewed, English can be switched off without a
 * deploy: remove "en" from the tts.cloneLanguages runtime setting.
 * Keep the two texts in step: a change of substance in one is a change in
 * the other, and each bumps its own version id.
 */
export const CLONE_CONSENT_TEXT_EN = [
  'Sesly creates an artificial copy of your voice (a voice model) from your voice recording so that stories can be told in your voice. Please read the information below before you continue.',
  'Your voice recording and the voice model created from it are considered biometric data, that is, special category personal data, under the Turkish Personal Data Protection Law No. 6698 (KVKK). We process this data only with your explicit consent.',
  'Purpose: Your recording is used only to create an artificial copy of your voice and to narrate stories with that voice for your own family. Sesly does not use your recording or your voice model for advertising or marketing purposes and does not sell them to third parties.',
  'Transfer abroad: The voice model is created and stored in the United States of America by our data processor, Cartesia, Inc. Stories are also narrated through this provider. For this reason your voice recording and your voice model are transferred abroad.',
  'Retention period: Your raw voice recording and your voice model are kept until you delete the voice profile or your account. When you delete them, the recording and the model are deleted both from our storage and from Cartesia.',
  'Your own voice only: You must record only your own voice with this feature. Recording the voice of another person is prohibited.',
  'Withdrawing your consent: You can withdraw your explicit consent at any time. To do so, it is enough to delete the relevant voice profile in the app. Deleting your account also deletes all voice recordings and voice models. For your other rights under the KVKK you can write to info@sesly.io.',
  'By approving, you give your explicit consent to the processing of your voice recording as described above and to its transfer abroad.',
].join('\n\n');

export const CLONE_INTRO_STEPS_EN: readonly CloneIntroStep[] = [
  {
    title: 'Find a quiet room',
    body: 'The quieter your surroundings, the more clearly Sesly learns your voice.',
  },
  {
    title: `Read a story for about ${CLONE_TARGET_SECONDS} seconds`,
    body: `We will show you a short story text. You need to read for at least ${CLONE_MIN_SECONDS} seconds; a longer recording preserves your accent better.`,
  },
  {
    title: 'Let your voice get ready',
    body: 'Your recording is usually ready in under a minute. You do not have to wait, we will let you know when it is ready.',
  },
];

export const CLONE_RECORDING_TIPS_EN: readonly CloneRecordingTip[] = [
  { icon: 'quiet', text: 'Record in a quiet room.' },
  { icon: 'distance', text: 'Hold the phone a hand span away from your mouth.' },
  { icon: 'calm', text: 'Read naturally and calmly, as if telling a story.' },
  { icon: 'pauses', text: 'Avoid long pauses and keep a steady flow.' },
];

/** Calm bedtime line used for the "listen to your voice" sample after cloning. */
export const CLONE_TEST_SAMPLE_TEXT =
  'Bir varmış, bir yokmuş. Uzak bir ormanın kıyısında, yıldızları sayan küçük bir tavşan yaşarmış.';
export const CLONE_TEST_SAMPLE_TEXT_EN =
  'Once upon a time, at the edge of a faraway forest, there lived a little rabbit who counted the stars.';

// ---------------------------------------------------------------------------
// Per-language content
// ---------------------------------------------------------------------------

/** Everything of the clone flow that depends on the language the user speaks. */
export interface CloneLanguageContent {
  scriptTitle: string;
  script: string;
  consentVersion: string;
  consentTitle: string;
  consentText: string;
  introSteps: readonly CloneIntroStep[];
  recordingTips: readonly CloneRecordingTip[];
  /** Line the new clone reads as its test sample and default preview. */
  testSampleText: string;
}

/**
 * Typed by the voice language list: a language added to VOICE_LANGUAGES
 * without its texts here does not compile.
 */
export const CLONE_LANGUAGE_CONTENT: Readonly<Record<VoiceLanguageCode, CloneLanguageContent>> = {
  tr: {
    scriptTitle: CLONE_SCRIPT_TITLE,
    script: CLONE_SCRIPT,
    consentVersion: CLONE_CONSENT_VERSION,
    consentTitle: CLONE_CONSENT_TITLE,
    consentText: CLONE_CONSENT_TEXT,
    introSteps: CLONE_INTRO_STEPS,
    recordingTips: CLONE_RECORDING_TIPS,
    testSampleText: CLONE_TEST_SAMPLE_TEXT,
  },
  en: {
    scriptTitle: CLONE_SCRIPT_TITLE_EN,
    script: CLONE_SCRIPT_EN,
    consentVersion: CLONE_CONSENT_VERSION_EN,
    consentTitle: CLONE_CONSENT_TITLE_EN,
    consentText: CLONE_CONSENT_TEXT_EN,
    introSteps: CLONE_INTRO_STEPS_EN,
    recordingTips: CLONE_RECORDING_TIPS_EN,
    testSampleText: CLONE_TEST_SAMPLE_TEXT_EN,
  },
};

/**
 * Clone texts for a stored profile language ("tr", "tr-TR", "en-US").
 * A profile whose language is not a voice language (rows written while the
 * create DTO took any string) uses the Turkish texts, as it always did.
 */
export function cloneContentFor(language: string | null | undefined): CloneLanguageContent {
  const code = findVoiceLanguage(language)?.code ?? DEFAULT_VOICE_LANGUAGE;
  return CLONE_LANGUAGE_CONTENT[code];
}

/** A voice language as GET /voice-profiles/clone-config lists it. */
export interface CloneSupportedLanguage {
  /** Content language code ("tr"); send it as `language` when creating the clone. */
  code: string;
  /** Locale stored on the profile ("tr-TR"). */
  locale: string;
  /** Name of the language in the language itself ("Türkçe", "English"). */
  nativeName: string;
  englishName: string;
}

export interface CloneConfigResponse {
  enabled: boolean;
  provider: typeof CLONE_PROVIDER;
  /** Language of every text in this response (content language code). */
  language: string;
  /** Locale a clone in this language is stored with ("tr-TR"). */
  locale: string;
  /** Languages the user can choose to speak, in display order. */
  supportedLanguages: CloneSupportedLanguage[];
  minSeconds: number;
  targetSeconds: number;
  maxSeconds: number;
  scriptTitle: string;
  script: string;
  consentVersion: string;
  consentTitle: string;
  consentText: string;
  introSteps: CloneIntroStep[];
  recordingTips: CloneRecordingTip[];
}

/**
 * @param language the voice language whose texts are served (default Turkish)
 * @param supported the languages offered to the user (default: all of them)
 */
export function buildCloneConfig(
  language: VoiceLanguage = VOICE_LANGUAGES[0],
  supported: readonly VoiceLanguage[] = VOICE_LANGUAGES,
): CloneConfigResponse {
  const content = CLONE_LANGUAGE_CONTENT[language.code];
  return {
    enabled: true,
    provider: CLONE_PROVIDER,
    language: language.code,
    locale: language.locale,
    supportedLanguages: supported.map((l) => ({
      code: l.code,
      locale: l.locale,
      nativeName: l.nativeName,
      englishName: l.englishName,
    })),
    minSeconds: CLONE_MIN_SECONDS,
    targetSeconds: CLONE_TARGET_SECONDS,
    maxSeconds: CLONE_MAX_SECONDS,
    scriptTitle: content.scriptTitle,
    script: content.script,
    consentVersion: content.consentVersion,
    consentTitle: content.consentTitle,
    consentText: content.consentText,
    // Copies, so a caller mutating the response can never change the constants.
    introSteps: content.introSteps.map((step) => ({ ...step })),
    recordingTips: content.recordingTips.map((tip) => ({ ...tip })),
  };
}

/**
 * Upload validation for POST /voice-profiles/:id/upload-samples.
 * m4a is transcoded server-side (Cartesia does not accept it); WAV passes
 * through the same transcode so every clip reaches Cartesia identically.
 */
export const CLONE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const CLONE_UPLOAD_MIMETYPES: readonly string[] = [
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
];

/** Sentinel voiceId mobile sends to POST /voice-profiles/v2 to start a clone. */
export const CLONE_PLACEHOLDER_VOICE_ID = 'custom-cloning-pending';

/** Prefix of the temporary voiceId a clone carries until Cartesia returns an id. */
export const PENDING_VOICE_ID_PREFIX = 'pending-';
