import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { APP_CONFIG } from '../constants';
import { SEO } from '../src/components/SEO';
import Phone from '../components/phone/Phone';
import { MOCK, MockLang, coverSrc } from '../components/phone/mockData';
import {
  AlertCircleOutlineIcon,
  BookOutlineIcon,
  CheckmarkIcon,
  ChevronDownIcon,
  HeadsetOutlineIcon,
  InformationCircleOutlineIcon,
  LanguageOutlineIcon,
  ListOutlineIcon,
  LogoAppleIcon,
  LogoGooglePlaystoreIcon,
  MailOutlineIcon,
  MicOutlineIcon,
  MoonOutlineIcon,
  PeopleOutlineIcon,
  PulseOutlineIcon,
  ShieldCheckmarkOutlineIcon,
  SparklesOutlineIcon,
  SpeedometerOutlineIcon,
} from '../components/Icons';

type Slot = 'uyku' | 'turk' | 'dunya' | 'egitici' | 'own';

const SLOT_COLOR: Record<Slot, string> = {
  uyku: '#C3B9E6',
  turk: '#EBC3A3',
  dunya: '#AACAE3',
  egitici: '#BBD8AA',
  own: '#C3B9E6',
};

/** The own-voice card gradient of the app (derivePalette ownA to ownC, murekkep). */
const OWN_GRADIENT = 'linear-gradient(135deg, #43434C 0%, #36363D 45%, #27282C 100%)';

const useLang = (): MockLang => {
  const { i18n } = useTranslation();
  return (i18n.language || 'tr').startsWith('en') ? 'en' : 'tr';
};

const SectionHead: React.FC<{ id: string; title: string; lead?: string; center?: boolean }> = ({ id, title, lead, center }) => (
  <div className={`max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
    <h2 id={id} className="section-title">{title}</h2>
    {lead && <p className="lead mt-4">{lead}</p>}
  </div>
);

const StoreButtons: React.FC<{ center?: boolean; className?: string }> = ({ center, className }) => {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-4 ${center ? 'justify-center' : ''} ${className ?? ''}`}>
      <a href={APP_CONFIG.playStoreLink} rel="noopener" className="btn btn-lg btn-primary">
        <LogoGooglePlaystoreIcon />
        {t('store.googlePlay')}
      </a>
      <span className="inline-flex items-center gap-2 text-[15px] font-extrabold text-text2">
        <LogoAppleIcon className="h-5 w-5 text-text3" />
        {t('store.iosSoon')}
      </span>
    </div>
  );
};

// ─── Hero ────────────────────────────────────────────────────────────

const Hero: React.FC = () => {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-title">
      <div className="hero-sky pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="wrap relative grid items-center gap-12 pb-16 pt-10 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-24 lg:pt-20">
        <div className="text-center lg:text-left">
          <p className="eyebrow">
            <MoonOutlineIcon className="h-5 w-5 text-uyku" />
            {t('home.hero.eyebrow')}
          </p>
          <h1 id="hero-title" className="mt-4 text-[44px] leading-[1.15] sm:text-[56px] lg:text-[68px]">
            <span className="block">{t('home.hero.titleA')}</span>
            <span className="block text-action">{t('home.hero.titleB')}</span>
          </h1>
          <p className="lead mx-auto mt-5 max-w-xl lg:mx-0">{t('home.hero.lead')}</p>
          <div className="mt-8">
            <StoreButtons className="justify-center lg:justify-start" />
          </div>
          <p className="mt-6 text-[15px] text-text3">{t('home.hero.note')}</p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <div className="hero-phones flex items-start">
            <Phone screen="home" lang={lang} label={t('home.hero.phoneHome')} eager className="relative z-10" />
            <Phone screen="story" lang={lang} label={t('home.hero.phoneStory')} eager className="hero-back relative z-0 hidden sm:block" />
          </div>
        </div>
      </div>
    </section>
  );
};

// ─── How it works ────────────────────────────────────────────────────

const HowItWorks: React.FC = () => {
  const { t } = useTranslation();
  const lang = useLang();
  const c = MOCK[lang];
  const shelf = c.shelves[0].items.slice(0, 3);

  const steps = [
    {
      key: 'pick',
      icon: <BookOutlineIcon className="h-6 w-6" />,
      color: SLOT_COLOR.uyku,
      fragment: (
        <div className="grid grid-cols-3 gap-3">
          {shelf.map((s) => (
            <div key={s.key}>
              <div className="overflow-hidden rounded-lg shadow-[0_0_0_1px_#2C2E31,0_3px_0_#060707]">
                <img src={coverSrc(s.key, 240)} alt="" width={240} height={360} loading="lazy" decoding="async" className="aspect-[2/3] w-full object-cover" />
              </div>
              <p className="mt-2 text-[13px] leading-[18px] text-text">{s.title}</p>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'voice',
      icon: <MicOutlineIcon className="h-6 w-6" />,
      color: SLOT_COLOR.own,
      fragment: (
        <div className="m-app">
          <p className="m-sub mb-3 text-text">{c.cardsTitle}</p>
          <div className="m-ncards">
            <div className="m-nc m-sel">
              <span className="m-avatar" style={{ background: 'var(--own)' }}><PulseOutlineIcon /></span>
              <b>{c.own[0]}</b>
              <small>{c.own[1]}</small>
              <span className="m-check"><CheckmarkIcon /></span>
            </div>
            {c.narrators.map((name, i) => (
              <div className="m-nc" key={name}>
                <span className="m-avatar" style={{ background: i === 0 ? 'var(--cat-dunya)' : 'var(--cat-turk)' }}>{name[0]}</span>
                <b>{name}</b>
                <small>{c.ready}</small>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'listen',
      icon: <MoonOutlineIcon className="h-6 w-6" />,
      color: SLOT_COLOR.uyku,
      fragment: (
        <div className="m-app">
          <p className="m-seglabel">{c.timerModeLabel}</p>
          <div className="m-seg">
            <span>{c.timerModes[0]}</span>
            <span className="m-on">{c.timerModes[1]}</span>
          </div>
          <div className="m-opts mt-3">
            <div className="m-opt m-tint">
              <span className="m-oi" style={{ background: 'var(--cat-uyku)', color: 'var(--on-cat)' }}><MoonOutlineIcon /></span>
              <span><small>{c.timerLeft}</small><b>{c.timerValue}</b></span>
              <span className="m-drain"><i /></span>
            </div>
            <div className="m-opt">
              <span className="m-oi" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}><SpeedometerOutlineIcon /></span>
              <span><small>{c.speed}</small><b>{c.speedValue}</b></span>
            </div>
          </div>
          <div className="m-fade">
            <span>{c.timerFade}</span>
            <span className="m-switch"><i /></span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section id="nasil-calisir" className="py-16 md:py-24" aria-labelledby="how-title">
      <div className="wrap">
        <SectionHead id="how-title" title={t('home.how.title')} lead={t('home.how.lead')} />
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.key} className="card flex flex-col p-5 sm:p-6">
              <div className="flex min-h-[236px] flex-col justify-center rounded-xl bg-bg p-4" aria-hidden="true">
                {step.fragment}
              </div>
              <div className="mt-6 flex items-center gap-3">
                <span
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-md bg-surface2 shadow-lip-sm"
                  style={{ color: step.color }}
                >
                  {step.icon}
                </span>
                <span className="text-[14px] font-extrabold text-text3">{t('home.how.step', { n: i + 1 })}</span>
              </div>
              <h3 className="mt-3 text-[24px] leading-[1.3] text-text">{t(`home.how.steps.${step.key}.title`)}</h3>
              <p className="mt-2 text-[16px] leading-relaxed text-text2">{t(`home.how.steps.${step.key}.text`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

// ─── Features ────────────────────────────────────────────────────────

const FEATURES: { key: string; slot: Slot; icon: React.ReactNode }[] = [
  { key: 'narrators', slot: 'dunya', icon: <HeadsetOutlineIcon className="h-6 w-6" /> },
  { key: 'tales', slot: 'turk', icon: <BookOutlineIcon className="h-6 w-6" /> },
  { key: 'timer', slot: 'uyku', icon: <MoonOutlineIcon className="h-6 w-6" /> },
  { key: 'queue', slot: 'egitici', icon: <ListOutlineIcon className="h-6 w-6" /> },
  { key: 'parents', slot: 'turk', icon: <PeopleOutlineIcon className="h-6 w-6" /> },
  { key: 'languages', slot: 'dunya', icon: <LanguageOutlineIcon className="h-6 w-6" /> },
];

const FeatureIcon: React.FC<{ slot: Slot; children: React.ReactNode }> = ({ slot, children }) => (
  <span
    className="flex h-12 w-12 flex-none items-center justify-center rounded-md bg-surface2 shadow-lip-sm"
    style={{ color: SLOT_COLOR[slot] }}
    aria-hidden="true"
  >
    {children}
  </span>
);

const Features: React.FC = () => {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <section id="ozellikler" className="border-y border-bar-line bg-bar py-16 md:py-24" aria-labelledby="features-title">
      <div className="wrap">
        <SectionHead id="features-title" title={t('home.features.title')} lead={t('home.features.lead')} />
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-[auto_1fr] lg:gap-12">
          <div className="flex justify-center lg:sticky lg:top-24">
            <Phone screen="player" lang={lang} label={t('home.features.phonePlayer')} className="feature-phone" />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <article className="rounded-xl p-6 shadow-lip-md sm:col-span-2" style={{ background: OWN_GRADIENT }}>
              <div className="flex items-center gap-4">
                <FeatureIcon slot="own"><MicOutlineIcon className="h-6 w-6" /></FeatureIcon>
                <h3 className="text-[26px] leading-[1.3] text-text">{t('home.features.items.ownVoice.title')}</h3>
              </div>
              <p className="mt-3 text-[17px] leading-relaxed text-text">{t('home.features.items.ownVoice.text')}</p>
              <p className="mt-4 flex gap-3 rounded-md bg-black/20 p-4 text-[15px] leading-relaxed text-text2">
                <ShieldCheckmarkOutlineIcon className="mt-0.5 h-5 w-5 flex-none text-success" />
                <span>{t('home.features.items.ownVoice.privacy')}</span>
              </p>
            </article>

            {FEATURES.map((f) => (
              <article key={f.key} className="card p-6">
                <div className="flex items-center gap-4">
                  <FeatureIcon slot={f.slot}>{f.icon}</FeatureIcon>
                  <h3 className="text-[22px] leading-[1.3] text-text">{t(`home.features.items.${f.key}.title`)}</h3>
                </div>
                <p className="mt-3 text-[16px] leading-relaxed text-text2">{t(`home.features.items.${f.key}.text`)}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

// ─── Shelf: a few real tales ─────────────────────────────────────────

interface ShelfTale {
  key: string;
  title: { tr: string; en: string };
  category: 'BEDTIME' | 'TURKISH_CLASSICS' | 'WORLD_CLASSICS';
  age: string;
  /** Language of the original text; a Turkish version of an English tale is an AI translation. */
  original: 'tr' | 'en';
  rights: 'publicDomain' | 'folk' | 'ccby';
  warnings: string[];
}

// stories/batch1/import-batch1.json
const SHELF: ShelfTale[] = [
  { key: 'kunos-kel-oglan', title: { tr: 'Kel Oğlan', en: 'Kel Oğlan' }, category: 'TURKISH_CLASSICS', age: '6-10', original: 'tr', rights: 'folk', warnings: ['BAD_EXAMPLE'] },
  { key: 'goodnight-tinku', title: { tr: 'İyi Geceler, Tinku', en: 'Goodnight, Tinku!' }, category: 'BEDTIME', age: '3-6', original: 'en', rights: 'ccby', warnings: [] },
  { key: 'little-red-riding-hood', title: { tr: 'Kırmızı Başlıklı Kız', en: 'Little Red Riding-Hood' }, category: 'WORLD_CLASSICS', age: '3-6', original: 'en', rights: 'publicDomain', warnings: ['SCARY', 'VIOLENCE', 'DEATH'] },
  { key: 'kunos-kabak-kiz', title: { tr: 'Kabak Kız', en: 'Kabak Kız' }, category: 'TURKISH_CLASSICS', age: '6-10', original: 'tr', rights: 'folk', warnings: ['OLD_LANGUAGE'] },
  { key: 'ramyas-stars', title: { tr: "Ramya'nın Yıldızları", en: "Ramya's Stars" }, category: 'BEDTIME', age: '3-6', original: 'en', rights: 'ccby', warnings: [] },
  { key: 'the-flying-ship', title: { tr: 'Uçan Gemi', en: 'The Flying Ship' }, category: 'WORLD_CLASSICS', age: '6-10', original: 'en', rights: 'publicDomain', warnings: ['OLD_LANGUAGE', 'VIOLENCE'] },
];

const CATEGORY_SLOT: Record<ShelfTale['category'], Slot> = {
  BEDTIME: 'uyku',
  TURKISH_CLASSICS: 'turk',
  WORLD_CLASSICS: 'dunya',
};

const Shelf: React.FC = () => {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <section className="py-16 md:py-24" aria-labelledby="shelf-title">
      <div className="wrap">
        <SectionHead id="shelf-title" title={t('home.shelf.title')} lead={t('home.shelf.lead')} />
        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {SHELF.map((tale) => {
            // Turkish tales exist only in Turkish; other tales show the visitor's language.
            const shownLang = tale.original === 'tr' ? 'tr' : lang;
            const translated = shownLang === 'tr' && tale.original === 'en';
            const title = tale.title[lang];
            const slot = CATEGORY_SLOT[tale.category];
            return (
              <li key={tale.key} className="flex flex-col">
                <div className="overflow-hidden rounded-xl shadow-[0_0_0_1px_#2C2E31,0_4px_0_#060707]">
                  <img
                    src={coverSrc(tale.key, 240)}
                    srcSet={`${coverSrc(tale.key, 240)} 240w, ${coverSrc(tale.key, 480)} 480w`}
                    sizes="(min-width: 1080px) 170px, (min-width: 600px) 30vw, 45vw"
                    alt={t('home.shelf.coverAlt', { title })}
                    width={240}
                    height={360}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[2/3] w-full object-cover"
                  />
                </div>
                <h3 className="mt-3 text-[19px] leading-[1.3] text-text">{title}</h3>
                <p className="mt-1 flex items-center gap-2 text-[13.5px] text-text2">
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: SLOT_COLOR[slot] }} aria-hidden="true" />
                  {t(`home.shelf.categories.${tale.category}`)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="tag">{t('home.shelf.age', { range: tale.age })}</span>
                  <span className="tag">{t(shownLang === 'tr' ? 'home.shelf.langTr' : 'home.shelf.langEn')}</span>
                  <span className="tag">{t(`home.shelf.${tale.rights}`)}</span>
                  {translated && (
                    <span className="tag max-w-full whitespace-normal">
                      <SparklesOutlineIcon />
                      {t('home.shelf.translated')}
                    </span>
                  )}
                </div>
                {tale.warnings.length > 0 && (
                  <p className="mt-2 flex gap-1.5 text-[13px] leading-[18px] text-text3">
                    <AlertCircleOutlineIcon className="mt-px h-4 w-4 flex-none" />
                    <span>{tale.warnings.map((w) => t(`home.shelf.warnings.${w}`)).join(', ')}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

// ─── Plans ───────────────────────────────────────────────────────────

const Plans: React.FC = () => {
  const { t } = useTranslation();
  const list = (key: string) => t(`home.plans.${key}.items`, { returnObjects: true }) as string[];

  const PlanItems: React.FC<{ items: string[] }> = ({ items }) => (
    <ul className="mt-5 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[15.5px] leading-snug text-text">
          <CheckmarkIcon className="mt-px h-5 w-5 flex-none text-success" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section id="planlar" className="border-y border-bar-line bg-bar py-16 md:py-24" aria-labelledby="plans-title">
      <div className="wrap">
        <SectionHead id="plans-title" title={t('home.plans.title')} lead={t('home.plans.lead')} />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <article className="card flex flex-col p-6">
            <h3 className="text-[26px] leading-[1.3] text-text">{t('home.plans.free.name')}</h3>
            <p className="mt-2 font-display text-[40px] leading-[1.2] text-text">{t('home.plans.free.price')}</p>
            <PlanItems items={list('free')} />
            <p className="mt-3 flex gap-3 text-[15px] leading-snug text-text3">
              <InformationCircleOutlineIcon className="mt-px h-5 w-5 flex-none" />
              <span>{t('home.plans.free.limit')}</span>
            </p>
          </article>

          <article className="card flex flex-col p-6">
            <h3 className="text-[26px] leading-[1.3] text-text">{t('home.plans.mini.name')}</h3>
            <p className="mt-2 text-text">
              <span className="font-display text-[40px] leading-[1.2]">{t('home.plans.mini.price')}</span>{' '}
              <span className="text-[15px] text-text2">{t('home.plans.perMonth')}</span>
            </p>
            <PlanItems items={list('mini')} />
          </article>

          <article className="flex flex-col rounded-xl p-6 shadow-[inset_0_0_0_2px_#7ACFBE,0_3px_0_#33978A]" style={{ background: OWN_GRADIENT }}>
            <h3 className="text-[26px] leading-[1.3] text-text">{t('home.plans.premium.name')}</h3>
            <p className="mt-2 text-text">
              <span className="font-display text-[40px] leading-[1.2]">{t('home.plans.premium.price')}</span>{' '}
              <span className="text-[15px] text-text2">{t('home.plans.perMonth')}</span>
            </p>
            <p className="text-[15px] text-text2">
              {t('home.plans.or')} <span className="text-text">{t('home.plans.premium.yearly')}</span> {t('home.plans.perYear')}
            </p>
            <PlanItems items={list('premium')} />
          </article>
        </div>
        <div className="mt-8 space-y-3 text-[15px] leading-relaxed text-text2">
          <p className="flex gap-3">
            <LogoGooglePlaystoreIcon className="mt-0.5 h-5 w-5 flex-none text-text3" />
            <span>{t('home.plans.notes.store')}</span>
          </p>
          <p className="flex gap-3">
            <InformationCircleOutlineIcon className="mt-0.5 h-5 w-5 flex-none text-text3" />
            <span>{t('home.plans.notes.price')}</span>
          </p>
        </div>
      </div>
    </section>
  );
};

// ─── FAQ ─────────────────────────────────────────────────────────────

const FAQ_ITEMS: { key: string; to?: string }[] = [
  { key: 'free' },
  { key: 'record' },
  { key: 'privacy', to: '/privacy' },
  { key: 'tales' },
  { key: 'languages' },
  { key: 'cancel' },
  { key: 'ios' },
  { key: 'delete', to: '/data-deletion' },
];

const Faq: React.FC = () => {
  const { t } = useTranslation();
  return (
    <section id="sorular" className="py-16 md:py-24" aria-labelledby="faq-title">
      <div className="wrap max-w-[860px]">
        <SectionHead id="faq-title" title={t('home.faq.title')} />
        <div className="mt-10 space-y-4">
          {FAQ_ITEMS.map(({ key, to }) => (
            <details key={key} className="faq card group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 text-[18px] font-extrabold leading-snug text-text sm:px-6">
                <span>{t(`home.faq.items.${key}.q`)}</span>
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-sm bg-surface2 text-text2 transition-transform group-open:rotate-180">
                  <ChevronDownIcon className="h-5 w-5" />
                </span>
              </summary>
              <div className="px-5 pb-5 text-[16px] leading-relaxed text-text2 sm:px-6">
                <p>{t(`home.faq.items.${key}.a`)}</p>
                {to && (
                  <p className="mt-3">
                    <Link to={to} className="link">{t(`home.faq.items.${key}.link`)}</Link>
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── Download ────────────────────────────────────────────────────────

const Download: React.FC = () => {
  const { t } = useTranslation();
  return (
    <section id="indir" className="pb-16 md:pb-24" aria-labelledby="cta-title">
      <div className="wrap">
        <div className="relative overflow-hidden rounded-sheet px-6 py-12 text-center shadow-lip-lg sm:px-10 md:py-16" style={{ background: OWN_GRADIENT }}>
          <div className="hero-sky pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
          <div className="relative">
            <img
              src="/image/sesly-icon-192.png"
              alt={t('home.cta.iconAlt')}
              width={88}
              height={88}
              loading="lazy"
              className="mx-auto h-[88px] w-[88px] rounded-[22px] shadow-lip-md"
            />
            <h2 id="cta-title" className="section-title mt-6">{t('home.cta.title')}</h2>
            <p className="lead mx-auto mt-4 max-w-xl text-text">{t('home.cta.text')}</p>
            <div className="mt-8">
              <StoreButtons center />
            </div>
            <p className="mt-10 text-[15px] text-text2">{t('home.cta.contact')}</p>
            <a
              href={`mailto:${APP_CONFIG.contactEmail}`}
              className="mt-2 inline-flex items-center gap-2 font-display text-[24px] text-text transition-colors hover:text-action"
            >
              <MailOutlineIcon className="h-6 w-6 text-action" />
              {APP_CONFIG.contactEmail}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

const Home: React.FC = () => (
  <div className="overflow-x-clip">
    <SEO titleKey="seo.home.title" descriptionKey="seo.home.description" path="/" />
    <Hero />
    <HowItWorks />
    <Features />
    <Shelf />
    <Plans />
    <Faq />
    <Download />
  </div>
);

export default Home;
