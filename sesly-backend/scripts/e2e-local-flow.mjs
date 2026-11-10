/* eslint-disable no-console */
/**
 * Full API end-to-end flow against a LOCAL backend + Firebase Auth emulator.
 * Creates a throwaway emulator user, exercises stories, favorites, a
 * ready-made (Google) narration, the voice-clone pipeline (real Cartesia),
 * a narration in the cloned voice, error codes, notifications, then deletes
 * the account. See sesly-mobile/e2e/README.md for the local stack.
 *
 *   node scripts/e2e-local-flow.mjs            # full flow incl. Cartesia clone
 *   node scripts/e2e-local-flow.mjs --no-clone # skip the Cartesia part
 *   node scripts/e2e-local-flow.mjs --keep     # keep the test user at the end
 *
 * Env: BASE_URL (default http://localhost:3000),
 *      FIREBASE_AUTH_EMULATOR_HOST (default 127.0.0.1:9099),
 *      E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (default: the local seed admin
 *      that prisma/seed.ts creates) for the settings and catalogue section.
 * Refuses to run against anything but localhost.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMU = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const args = new Set(process.argv.slice(2));
const WITH_CLONE = !args.has('--no-clone');

for (const u of [BASE, `http://${EMU}`]) {
  const host = new URL(u).hostname;
  if (!['localhost', '127.0.0.1', '10.0.2.2'].includes(host)) {
    console.error(`Refusing to run: ${u} is not local.`);
    process.exit(2);
  }
}

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return ok;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

let token = '';
async function api(method, path, body, { raw = false, form = false, redirect = 'follow', auth } = {}) {
  // auth: undefined = the test user's token, null = anonymous, string = that token.
  const bearer = auth === undefined ? token : auth;
  const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
  let payload;
  if (form) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function poll(fn, done, { every = 3000, max = 300000 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < max) {
    last = await fn();
    if (done(last)) return last;
    await sleep(every);
  }
  return last;
}

const SECRET_KEYS = ['passwordHash', 'emailVerificationToken', 'passwordResetToken', 'voiceCloningKey', 'consentAudioUrl', 'stripeCustomerId'];
const leaks = obj => SECRET_KEYS.filter(k => JSON.stringify(obj ?? {}).includes(`"${k}"`));

// Local seed admin: env wins, else the credentials prisma/seed.ts creates.
function seedAdmin() {
  const seed = readFileSync(new URL('../prisma/seed.ts', import.meta.url), 'utf8');
  return {
    email: process.env.E2E_ADMIN_EMAIL || seed.match(/prisma\.admin\.upsert\(\{\s*where:\s*\{\s*email:\s*'([^']+)'/)?.[1],
    password: process.env.E2E_ADMIN_PASSWORD || seed.match(/adminPassword\s*=\s*await bcrypt\.hash\('([^']+)'/)?.[1],
  };
}

const formData = fields => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fd;
};
const flatSettings = body => (body?.groups ?? []).flatMap(g => g.settings ?? []);

/**
 * Runtime settings + multi-language catalogue (the admin panel features).
 * Runs while the test user's token is still valid, plus an admin token.
 * Every setting it touches is put back and the draft story is deleted.
 */
async function settingsAndCatalogue() {
  const { email, password } = seedAdmin();
  const login = await api('POST', '/admin/auth/login', { email, password }, { auth: null });
  const admin = login.body?.accessToken;
  if (!check('admin login (local seed admin)', login.status === 200 && !!admin && login.body?.admin?.role === 'SUPER_ADMIN', `status ${login.status}`)) return;
  const adm = (method, path, body, opts = {}) => api(method, path, body, { ...opts, auth: admin });
  const anonGet = path => api('GET', path, undefined, { auth: null });

  // --- settings ---
  const anon = await anonGet('/admin/settings');
  check('GET /admin/settings without token -> 401', anon.status === 401, `status ${anon.status}`);
  const asUser = await api('GET', '/admin/settings');
  check('GET /admin/settings with a user token -> 401', asUser.status === 401, `status ${asUser.status}`);
  const s0 = await adm('GET', '/admin/settings');
  const groupIds = (s0.body?.groups ?? []).map(g => g.id).join(',');
  const all = flatSettings(s0.body);
  check('GET /admin/settings groups in order', s0.status === 200 && groupIds === 'rateLimit,i18n,content,llm,tts', groupIds);
  check('settings carry value, source, fallback and env name',
    all.length >= 18 && all.every(x => 'value' in x && ['panel', 'env', 'default'].includes(x.source) && 'fallbackValue' in x && typeof x.envVar === 'string' && x.constraints),
    `${all.length} settings`);
  const secretLike = all.filter(x => /KEY|SECRET|PASSWORD|_URL$|DATABASE|REDIS|JWT/.test(x.envVar)).map(x => x.envVar);
  check('no key, secret or URL is exposed as a setting', secretLike.length === 0, secretLike.join(','));

  const TEMP = 'llm.gemini.temperature';
  const AUTO = 'llm.autoAssessLevel';
  const before = Object.fromEntries([TEMP, AUTO].map(k => [k, all.find(x => x.key === k)]));
  const restore = async () => {
    for (const [key, was] of Object.entries(before)) {
      if (!was) continue;
      if (was.source === 'panel') await adm('PATCH', '/admin/settings', { values: { [key]: was.value } });
      else await adm('DELETE', `/admin/settings/${key}`);
    }
  };

  let draftId;
  try {
    const unknown = await adm('PATCH', '/admin/settings', { values: { 'no.such.key': 1 } });
    check('PATCH unknown setting -> 400 in Turkish', unknown.status === 400 && /Bilinmeyen ayar anahtarı/.test(unknown.body?.message ?? ''), `status ${unknown.status} ${unknown.body?.message ?? ''}`);
    const mixed = await adm('PATCH', '/admin/settings', { values: { [AUTO]: !before[AUTO]?.value, [TEMP]: 99 } });
    const autoAfterMixed = flatSettings((await adm('GET', '/admin/settings')).body).find(x => x.key === AUTO);
    check('PATCH with one bad value -> 400 and nothing written',
      mixed.status === 400 && /arasında olmalıdır/.test(mixed.body?.message ?? '') && autoAfterMixed?.value === before[AUTO]?.value && autoAfterMixed?.source === before[AUTO]?.source,
      `status ${mixed.status} ${mixed.body?.message ?? ''}`);
    const empty = await adm('PATCH', '/admin/settings', { values: {} });
    check('PATCH with no values -> 400', empty.status === 400, `status ${empty.status}`);
    const extra = await adm('PATCH', '/admin/settings', { values: { [TEMP]: 0.3 }, other: 1 });
    check('PATCH with an extra property -> 400', extra.status === 400, `status ${extra.status}`);

    // Automatic level tagging is switched off so the draft below costs no Gemini call.
    const ok = await adm('PATCH', '/admin/settings', { values: { [TEMP]: '0.35', [AUTO]: false } });
    const t1 = flatSettings(ok.body).find(x => x.key === TEMP);
    const a1 = flatSettings(ok.body).find(x => x.key === AUTO);
    check('PATCH /admin/settings stores panel values',
      ok.status === 200 && t1?.value === 0.35 && t1?.source === 'panel' && !!t1?.updatedAt && !!t1?.updatedByAdminId && a1?.value === false && a1?.source === 'panel',
      `status ${ok.status} ${ok.body?.message ?? ''} value ${t1?.value} source ${t1?.source}`);
    const reset = await adm('DELETE', `/admin/settings/${TEMP}`);
    check('DELETE /admin/settings/:key falls back',
      reset.status === 200 && reset.body?.key === TEMP && reset.body?.source !== 'panel' && reset.body?.updatedAt === null && reset.body?.value === reset.body?.fallbackValue,
      `status ${reset.status} source ${reset.body?.source}`);
    const resetAgain = await adm('DELETE', `/admin/settings/${TEMP}`);
    check('DELETE /admin/settings/:key is idempotent', resetAgain.status === 200, `status ${resetAgain.status}`);
    const resetUnknown = await adm('DELETE', '/admin/settings/no.such.key');
    check('DELETE unknown setting -> 404', resetUnknown.status === 404, `status ${resetUnknown.status}`);

    // --- public catalogue (anonymous, the way an old app asks) ---
    const langs = await anonGet('/stories/languages');
    const def = langs.body?.defaultLanguage ?? '';
    const enabled = (langs.body?.languages ?? []).map(l => l.code);
    const defRow = (langs.body?.languages ?? []).find(l => l.isDefault);
    check('GET /stories/languages',
      langs.status === 200 && !!def && enabled.includes(def) && defRow?.code === def && defRow.storyCount > 0 && Array.isArray(defRow.levels),
      `default ${def}, enabled ${enabled.join(',')}, ${defRow?.storyCount} stories`);
    const plain = await anonGet('/stories?limit=100');
    const items = plain.body?.data ?? [];
    check('GET /stories without parameters = default language', plain.status === 200 && items.length > 0 && items.every(s => s.language === def), `${plain.body?.total} stories`);
    const INTERNAL = ['content', 'status', 'slug', 'publishedAt', 'rightsBasis', 'translationGroupId', 'preprocessedSegments', 'languageLevelSource'];
    check('story list item shape (credit, summary, languageLevel, no internal column)',
      items.every(s => s.credit && typeof s.summary === 'string' && s.description === s.summary && 'languageLevel' in s && !INTERNAL.some(k => k in s)));
    const withLang = await anonGet(`/stories?limit=100&language=${def.toUpperCase()}-XX`);
    check('GET /stories?language=<default, upper case, with region> = same list', withLang.status === 200 && withLang.body?.total === plain.body?.total, `${withLang.body?.total} vs ${plain.body?.total}`);
    const other = ['en', 'de', 'tr'].find(c => !enabled.includes(c));
    if (other) {
      const off = await anonGet(`/stories?language=${other}`);
      check(`GET /stories?language=${other} (not enabled) -> empty page`, off.status === 200 && off.body?.total === 0 && Array.isArray(off.body?.data), `status ${off.status} total ${off.body?.total}`);
    }
    const badLang = await anonGet('/stories?language=xx');
    check('GET /stories?language=xx -> 400 in Turkish', badLang.status === 400 && /Geçersiz içerik dili/.test(badLang.body?.message ?? ''), `status ${badLang.status}`);
    const lvl = await anonGet('/stories?limit=100&languageLevel=a1,A2');
    check('GET /stories?languageLevel=a1,A2', lvl.status === 200 && (lvl.body?.data ?? []).every(s => ['A1', 'A2'].includes(s.languageLevel)), `status ${lvl.status}, ${lvl.body?.total} stories`);
    const lvlRepeat = await anonGet('/stories?languageLevel=B1&languageLevel=B2');
    check('GET /stories with a repeated languageLevel', lvlRepeat.status === 200 && (lvlRepeat.body?.data ?? []).every(s => ['B1', 'B2'].includes(s.languageLevel)), `status ${lvlRepeat.status}, ${lvlRepeat.body?.total} stories`);
    const badLvl = await anonGet('/stories?languageLevel=Z9');
    check('GET /stories?languageLevel=Z9 -> 400 in Turkish', badLvl.status === 400 && /Geçersiz dil seviyesi/.test(badLvl.body?.message ?? ''), `status ${badLvl.status}`);
    const sorted = await anonGet(`/stories?limit=100&language=${def}&sort=level`);
    const order = (sorted.body?.data ?? []).map(s => s.languageLevel ?? 'ZZ');
    check('GET /stories?language=&sort=level (easiest first, no level last)',
      sorted.status === 200 && sorted.body?.total === plain.body?.total && order.every((l, i) => i === 0 || order[i - 1] <= l), `status ${sorted.status}, ${order.length} stories`);
    const badSort = await anonGet('/stories?sort=bogus');
    check('GET /stories?sort=bogus -> 400 in Turkish', badSort.status === 400 && /Geçersiz sıralama/.test(badSort.body?.message ?? ''), `status ${badSort.status}`);

    // --- admin catalogue ---
    const meta = await adm('GET', '/admin/stories/meta');
    const e = meta.body?.enums ?? {};
    const ENUMS = ['status', 'origin', 'textFidelity', 'rightsBasis', 'languageLevel', 'languageLevelSource', 'translationMethod', 'category', 'ageGroup', 'llmTaskType', 'llmTaskStatus'];
    check('GET /admin/stories/meta',
      meta.status === 200 && meta.body?.languages?.all?.length === 10 && meta.body.languages.default === def
        && ENUMS.every(k => Array.isArray(e[k]) && e[k].length > 0 && e[k].every(o => o.value && o.label))
        && e.status.map(o => o.value).join(',') === 'DRAFT,PUBLISHED,ARCHIVED' && meta.body?.sorts?.length === 5
        && meta.body?.publishRules?.always?.join(',') === 'origin,textFidelity',
      `status ${meta.status}`);
    const rows = await adm('GET', '/admin/stories?limit=5&status=published&sort=title');
    check('GET /admin/stories rows carry slug, status, translations and counts',
      rows.status === 200 && rows.body?.data?.length > 0
        && rows.body.data.every(r => r.status === 'PUBLISHED' && 'slug' in r && Array.isArray(r.translations) && Array.isArray(r.groupLanguages) && r._count),
      `status ${rows.status}, ${rows.body?.total} stories`);
    const tasks = await adm('GET', '/admin/stories/llm-tasks?limit=5');
    check('GET /admin/stories/llm-tasks', tasks.status === 200 && Array.isArray(tasks.body?.data) && 'totalPages' in tasks.body, `status ${tasks.status}`);

    const created = await adm('POST', '/admin/stories', formData({
      title: `E2E Taslak Öykü ${Date.now()}`,
      content: 'Bir varmış, bir yokmuş.\n\nKüçük bir serçe her sabah aynı dala konarmış.',
      ageGroup: 'THREE_TO_SIX',
      category: 'BEDTIME',
    }), { form: true });
    draftId = created.body?.id;
    check('POST /admin/stories creates a DRAFT with a generated slug',
      created.status === 201 && created.body?.status === 'DRAFT' && created.body?.language === 'tr' && /^e2e-taslak-oyku-\d+$/.test(created.body?.slug ?? '')
        && created.body?.publishedAt === null && created.body?.estimatedDuration >= 1,
      `status ${created.status} ${created.body?.message ?? created.body?.slug}`);
    if (draftId) {
      const hidden = await anonGet('/stories?limit=100');
      check('DRAFT is not in the public list', hidden.status === 200 && !(hidden.body?.data ?? []).some(s => s.id === draftId) && hidden.body?.total === plain.body?.total);
      const direct = await api('GET', `/stories/${draftId}`);
      check('GET /stories/:id of a DRAFT -> 404', direct.status === 404, `status ${direct.status}`);
      const pub1 = await adm('PATCH', `/admin/stories/${draftId}`, formData({ status: 'PUBLISHED' }), { form: true });
      check('publish without origin and fidelity -> 400 STORY_PUBLISH_REQUIREMENTS',
        pub1.status === 400 && pub1.body?.code === 'STORY_PUBLISH_REQUIREMENTS' && ['origin', 'textFidelity'].every(k => pub1.body?.missing?.includes(k)) && /Eksik alanlar/.test(pub1.body?.message ?? ''),
        `status ${pub1.status} missing ${pub1.body?.missing}`);
      const pub2 = await adm('PATCH', `/admin/stories/${draftId}`, formData({ status: 'PUBLISHED', origin: 'public_domain', textFidelity: 'VERBATIM' }), { form: true });
      check('publish a public-domain story without rights, source and credit -> 400',
        pub2.status === 400 && pub2.body?.code === 'STORY_PUBLISH_REQUIREMENTS' && ['rightsBasis', 'source', 'attribution'].every(k => pub2.body?.missing?.includes(k)),
        `status ${pub2.status} missing ${pub2.body?.missing}`);
      const still = await adm('GET', `/admin/stories/${draftId}`);
      check('story is still an untouched DRAFT after the failed publishes',
        still.status === 200 && still.body?.status === 'DRAFT' && still.body?.origin === null && still.body?.publishedAt === null, `status ${still.body?.status} origin ${still.body?.origin}`);
      const owned = await adm('PATCH', `/admin/stories/${draftId}`, formData({ languageLevelSource: 'AI' }), { form: true });
      check('PATCH with a server-owned field -> 400', owned.status === 400, `status ${owned.status}`);
    }
  } finally {
    if (draftId) {
      const del = await adm('DELETE', `/admin/stories/${draftId}`);
      check('delete the draft story', del.status === 200, `status ${del.status}`);
    }
    await restore();
    const endAll = flatSettings((await adm('GET', '/admin/settings')).body);
    check('touched settings are back to their starting state',
      Object.entries(before).every(([k, was]) => { const now = endAll.find(x => x.key === k); return !!now && !!was && now.source === was.source && now.value === was.value; }));
  }
}

async function main() {
  const email =`e2e-${Date.now()}@test.local`;
  const password = 'Test-123456';

  // 1. Emulator sign-up -> backend session
  const su = await fetch(`http://${EMU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then(r => r.json());
  check('emulator sign-up', !!su.idToken, su.error?.message);
  const verify = await api('POST', '/auth/firebase/verify', { idToken: su.idToken, firstName: 'Test', lastName: 'Kullanıcı' });
  token = verify.body?.accessToken;
  check('POST /auth/firebase/verify -> JWT', verify.status < 300 && !!token, `status ${verify.status}`);
  check('auth response has subscriptionTier', !!verify.body?.user?.subscriptionTier, verify.body?.user?.subscriptionTier);

  // 2. Profile hygiene
  const me = await api('GET', '/users/me');
  check('GET /users/me', me.status === 200);
  check('/users/me leaks no secrets', leaks(me.body).length === 0, leaks(me.body).join(','));
  check('/users/me has profileImageUrl key', me.body && 'profileImageUrl' in me.body);

  // 3. Stories + optional auth favorites
  const list = await api('GET', '/stories?limit=50');
  const stories = list.body?.data ?? [];
  check('GET /stories paginated', list.status === 200 && stories.length > 0 && 'totalPages' in list.body, `${stories.length} items`);
  check('story list has no content', stories.every(s => !('content' in s)));
  // Pick the two shortest REAL seed stories (prisma/seed-data); prisma/seed.ts
  // also inserts ~100-character placeholder stories that are useless here.
  const seedDir = new URL('../prisma/seed-data/', import.meta.url);
  const seeded = readdirSync(seedDir).filter(f => f.endsWith('.json'))
    .flatMap(f => JSON.parse(readFileSync(new URL(f, seedDir), 'utf8')))
    .sort((a, b) => a.content.length - b.content.length);
  const byTitle = new Map(stories.filter(s => !s.isPremium).map(s => [s.title, s]));
  const [storyA, storyB] = seeded.map(x => byTitle.get(x.title)).filter(Boolean);
  check('two free stories available', !!storyA && !!storyB);
  const fav = await api('POST', `/stories/${storyA.id}/favorite`);
  check('POST favorite', fav.status < 300, `status ${fav.status}`);
  const list2 = await api('GET', '/stories?limit=50');
  check('public list reflects isFavorite (optional auth)', list2.body?.data?.find(s => s.id === storyA.id)?.isFavorite === true);
  const unfav = await api('DELETE', `/stories/${storyA.id}/favorite`);
  check('DELETE favorite', unfav.status < 300, `status ${unfav.status}`);

  // 4. Ready-made voice + narration (real Google TTS)
  const voices = await api('GET', '/voice-profiles/available-voices');
  const google = voices.body?.google ?? [];
  check('available voices carry isPremium', google.length > 0 && google.every(v => typeof v.isPremium === 'boolean'), `${google.length} google voices`);
  // Available voices use `id`; POST /voice-profiles/v2 answers { profile, availableVoices }.
  const gv = google.find(v => !v.isPremium && /tr-TR/i.test(v.id)) ?? google.find(v => !v.isPremium);
  const preset = await api('POST', '/voice-profiles/v2', { name: 'E2E Anlatıcı', provider: 'GOOGLE', voiceId: gv?.id, language: 'tr-TR' });
  check('create preset profile', preset.status < 300 && preset.body?.profile?.kind === 'PRESET', `status ${preset.status} ${preset.body?.message ?? preset.body?.profile?.kind}`);
  const presetId = preset.body?.profile?.id;

  const nar = await api('POST', '/narrations', { storyId: storyA.id, voiceProfileId: presetId });
  check('POST /narrations', nar.status < 300, `status ${nar.status} ${nar.body?.message ?? ''}`);
  const narId = nar.body?.id;
  const gen = await api('POST', `/narrations/${narId}/generate`);
  check('POST /narrations/:id/generate', gen.status < 300, `status ${gen.status} ${gen.body?.message ?? ''}`);
  const st = await poll(() => api('GET', `/narrations/${narId}/status`), r => ['READY', 'FAILED'].includes(r.body?.status));
  check('Google narration READY', st.body?.status === 'READY', `${st.body?.status} ${st.body?.errorMessage ?? ''}`);
  const one = await api('GET', `/narrations/${narId}`);
  check('narration detail has totalDuration + updatedAt', one.body && 'totalDuration' in one.body && 'updatedAt' in one.body);
  check('narration story has no content', one.body?.story && !('content' in one.body.story));
  const stream = await api('GET', `/narrations/${narId}/stream`, undefined, { raw: true, redirect: 'manual' });
  const loc = stream.headers.get('location') || '';
  check('stream redirects to signed GCS URL', [301, 302, 307].includes(stream.status) && loc.startsWith('https://'), `status ${stream.status}`);
  const dup = await api('POST', '/narrations', { storyId: storyA.id, voiceProfileId: presetId });
  check('duplicate narration -> 409 NARRATION_EXISTS', dup.status === 409 && dup.body?.code === 'NARRATION_EXISTS' && dup.body?.existingNarrationId === narId, `status ${dup.status} code ${dup.body?.code}`);

  // 5. Voice clone (real Cartesia)
  if (WITH_CLONE) {
    const cfg = await api('GET', '/voice-profiles/clone-config');
    check('clone-config', cfg.status === 200 && cfg.body?.maxSeconds === 60 && !!cfg.body?.consentVersion, `v ${cfg.body?.consentVersion}`);
    const pending = await api('POST', '/voice-profiles/v2', { name: 'E2E Klon', provider: 'CARTESIA', voiceId: 'custom-cloning-pending', language: 'tr-TR' });
    check('create clone placeholder', pending.status < 300 && pending.body?.profile?.kind === 'CLONE' && pending.body?.profile?.status === 'PENDING', `status ${pending.status}`);
    const cloneId = pending.body?.profile?.id;

    // Reference clip: 35 s of the Google narration, mono 44.1 kHz WAV.
    const dir = mkdtempSync(join(tmpdir(), 'sesly-e2e-'));
    const mp3 = join(dir, 'narration.mp3');
    const wav = join(dir, 'reference.wav');
    const tinyWav = join(dir, 'tiny.wav');
    writeFileSync(mp3, Buffer.from(await (await fetch(loc)).arrayBuffer()));
    execFileSync(require('ffmpeg-static'), ['-y', '-loglevel', 'error', '-i', mp3, '-t', '35', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);
    // The server answers CONSENT_REQUIRED before the client finishes streaming a
    // multi-MB body and undici then aborts the write; use a 1 s clip for that check.
    execFileSync(require('ffmpeg-static'), ['-y', '-loglevel', 'error', '-i', wav, '-t', '1', tinyWav]);
    const upload = async (withConsent, file = wav) => {
      const fd = new FormData();
      fd.append('referenceAudio', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'reference.wav');
      if (withConsent) fd.append('consentVersion', cfg.body.consentVersion);
      fd.append('speechStartMs', '0');
      return api('POST', `/voice-profiles/${cloneId}/upload-samples`, fd, { form: true });
    };
    const noConsent = await upload(false, tinyWav);
    check('upload without consent -> 400 CONSENT_REQUIRED', noConsent.status === 400 && noConsent.body?.code === 'CONSENT_REQUIRED', `status ${noConsent.status} code ${noConsent.body?.code}`);
    const up = await upload(true);
    check('upload with consent -> PROCESSING', up.status < 300 && up.body?.profile?.status === 'PROCESSING', `status ${up.status} ${up.body?.message ?? ''}`);
    const again = await upload(true, tinyWav);
    check('re-upload -> 409 VOICE_ALREADY_UPLOADED', again.status === 409 && again.body?.code === 'VOICE_ALREADY_UPLOADED', `status ${again.status} code ${again.body?.code}`);
    const second = await api('POST', '/voice-profiles/v2', { name: 'E2E Klon 2', provider: 'CARTESIA', voiceId: 'custom-cloning-pending', language: 'tr-TR' });
    check('second clone on FREE -> 403 CLONE_SLOT_LIMIT', second.status === 403 && second.body?.code === 'CLONE_SLOT_LIMIT', `status ${second.status} code ${second.body?.code}`);

    const vs = await poll(() => api('GET', `/voice-profiles/${cloneId}/status`), r => ['READY', 'FAILED'].includes(r.body?.status), { every: 4000, max: 240000 });
    check('Cartesia clone READY', vs.body?.status === 'READY', `${vs.body?.status} ${vs.body?.errorMessage ?? ''}`);
    const sample = await api('GET', `/voice-profiles/${cloneId}/sample`);
    check('clone test sample URL', typeof sample.body?.audioUrl === 'string' && sample.body.audioUrl.startsWith('https://'));

    if (vs.body?.status === 'READY') {
      const cn = await api('POST', '/narrations', { storyId: storyB.id, voiceProfileId: cloneId });
      const cg = await api('POST', `/narrations/${cn.body?.id}/generate`);
      check('clone narration started', cn.status < 300 && cg.status < 300, `status ${cn.status}/${cg.status} ${cg.body?.message ?? cn.body?.message ?? ''}`);
      const cs = await poll(() => api('GET', `/narrations/${cn.body?.id}/status`), r => ['READY', 'FAILED'].includes(r.body?.status));
      check('Cartesia narration READY', cs.body?.status === 'READY', `${cs.body?.status} ${cs.body?.errorMessage ?? ''}`);
      if (cs.body?.status === 'READY') {
        const s2 = await api('GET', `/narrations/${cn.body.id}/stream`, undefined, { raw: true, redirect: 'manual' });
        const clip = join(dir, 'clone-narration.mp3');
        writeFileSync(clip, Buffer.from(await (await fetch(s2.headers.get('location'))).arrayBuffer()));
        console.log(`      clone narration saved for listening: ${clip}`);
      }
    }
    const slots = await api('GET', '/voice-profiles/slots');
    check('slots split preset/clone', slots.body?.clone?.used === 1 && slots.body?.preset?.used === 1, JSON.stringify({ preset: slots.body?.preset, clone: slots.body?.clone }));
    const del = await api('DELETE', `/voice-profiles/${cloneId}`);
    check('delete clone profile (upstream + GCS)', del.status < 300, `status ${del.status}`);
  }

  // 6. Notifications written in Turkish with routing ids
  const notes = await api('GET', '/notifications');
  const items = notes.body?.items ?? [];
  const nr = items.find(n => n.type === 'NARRATION_READY');
  check('NARRATION_READY notification', !!nr && /Masalın hazır/.test(nr.title) && !!nr.data?.narrationId && !!nr.data?.storyId, nr?.title);
  if (WITH_CLONE) {
    const vr = items.find(n => n.type === 'VOICE_READY');
    check('VOICE_READY notification', !!vr && /Ses profilin hazır/.test(vr.title) && !!vr.data?.voiceProfileId, vr?.title);
  }
  check('no notification for preset voice add', !items.some(n => n.type === 'VOICE_READY' && n.data?.voiceProfileId === presetId));

  // 6b. Admin runtime settings + multi-language catalogue
  await settingsAndCatalogue();

  // 7. Logout revokes every token of the account (tokenVersion bump)
  const lo = await api('POST', '/auth/logout', { refreshToken: verify.body?.refreshToken });
  check('POST /auth/logout', lo.status === 200, `status ${lo.status}`);
  const stale = await api('GET', '/users/me');
  check('old access token rejected after logout', stale.status === 401, `status ${stale.status}`);
  const rf = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: verify.body?.refreshToken }),
  });
  check('old refresh token rejected after logout', rf.status === 401, `status ${rf.status}`);
  const again = await api('POST', '/auth/firebase/verify', { idToken: su.idToken });
  token = again.body?.accessToken;
  check('sign in again after logout', again.status < 300 && !!token, `status ${again.status}`);

  // 8. Account deletion (KVKK) incl. the emulator Firebase user
  if (!args.has('--keep')) {
    const gone = await api('DELETE', '/users/me');
    check('DELETE /users/me', gone.status < 300, `status ${gone.status}`);
    const lookup = await fetch(`http://${EMU}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: su.idToken }),
    }).then(r => r.json());
    check('Firebase user deleted', !lookup.users?.length, lookup.error?.message ?? 'still exists');
  } else {
    console.log(`      kept test user ${email} / ${password}`);
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
