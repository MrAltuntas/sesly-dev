import React from 'react';
import './phone.css';
import {
  BookIcon,
  BookmarkOutlineIcon,
  CheckmarkIcon,
  ChevronBackIcon,
  ChevronDownIcon,
  CompassOutlineIcon,
  EllipsisHorizontalIcon,
  GlobeOutlineIcon,
  BulbOutlineIcon,
  LibraryOutlineIcon,
  ListOutlineIcon,
  MicOutlineIcon,
  MoonOutlineIcon,
  NotificationsOutlineIcon,
  PauseIcon,
  PlayIcon,
  PulseOutlineIcon,
  RoseOutlineIcon,
  SparklesOutlineIcon,
  SpeedometerOutlineIcon,
} from '../Icons';
import { CatSlot, MOCK, MockCopy, MockLang, coverSrc } from './mockData';

export type PhoneScreen = 'home' | 'story' | 'player';

interface PhoneProps {
  screen: PhoneScreen;
  lang: MockLang;
  /** Accessible description of the screen (the mockup itself is decorative). */
  label: string;
  /** Load the pictures at once (first screen) instead of lazily. */
  eager?: boolean;
  className?: string;
  /** Scale of the 384 x 804 device, set per breakpoint through a CSS class instead when omitted. */
  style?: React.CSSProperties;
}

/** Sizes an icon the way the app does (24 for actions, 20 inline, 16 in chips). */
const sz = (n: number) => ({ width: n, height: n });

const StatusBar: React.FC = () => (
  <div className="m-status">
    <span>21:14</span>
    <span className="m-cam" />
    <span className="m-ri">
      <svg style={sz(16)} viewBox="0 0 24 24"><path d="M12 20.5 1.5 8.6a15.4 15.4 0 0 1 21 0z" /></svg>
      <svg style={sz(15)} viewBox="0 0 24 24"><path d="M21 3v18H3z" /></svg>
      <svg width="22" height="14" viewBox="0 0 30 16">
        <rect x="1" y="1.5" width="24" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3.4" y="3.9" width="15" height="8.2" rx="2" />
        <rect x="26.6" y="5.5" width="2.2" height="5" rx="1.1" />
      </svg>
    </span>
  </div>
);

/** The app's SkipIcon: an open ring, a chevron and "15". */
const SkipIcon: React.FC<{ forward?: boolean }> = ({ forward }) => {
  const size = 28;
  const cx = 12, cy = 13.5, r = 8.5, top = cy - r;
  const d = `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx} ${top} L14.5 ${top} M${cx} ${top - 2.5} L14.5 ${top} L${cx} ${top + 2.5}`;
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ fill: 'none', transform: forward ? undefined : 'scaleX(-1)' }}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <b style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', font: '800 9px/12px var(--body)', transform: 'translateY(1.75px)' }}>15</b>
    </span>
  );
};

const Img: React.FC<{ src: string; eager?: boolean; className?: string; w: number; h: number }> = ({ src, eager, className, w, h }) => (
  <img
    src={src}
    alt=""
    width={w}
    height={h}
    className={className}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
  />
);

const TILE_ICONS = [MoonOutlineIcon, RoseOutlineIcon, GlobeOutlineIcon, BulbOutlineIcon];
const TILE_COLORS: CatSlot[] = ['uyku', 'turk', 'dunya', 'egitici'];
const TAB_ICONS = [BookIcon, CompassOutlineIcon, LibraryOutlineIcon, MicOutlineIcon];

const HomeScreen: React.FC<{ c: MockCopy; eager?: boolean }> = ({ c, eager }) => (
  <div className="m-scr m-home">
    <div className="m-scroll">
      <div className="m-greet">
        <h3>{c.greet}</h3>
        <div className="m-tba">
          <div className="m-iconbtn"><NotificationsOutlineIcon className="" /><span className="m-bdot" /></div>
          <div className="m-avatar">{c.initial}</div>
        </div>
      </div>
      <div className="m-hero">
        <Img src={coverSrc(c.hero.key, 480)} w={480} h={720} eager={eager} />
        <div className="m-shade" />
        <span className="m-tag m-htag">{c.heroTag}</span>
        <div className="m-bot">
          <div>
            <h4>{c.hero.title}</h4>
            <div className="m-chips">
              <span className="m-tag m-glass">{c.hero.minutes}</span>
              <span className="m-tag m-glass">{c.hero.age}</span>
            </div>
          </div>
          <div className="m-play"><PlayIcon /></div>
        </div>
      </div>
      <div className="m-tiles">
        {c.tiles.map((label, i) => {
          const Icon = TILE_ICONS[i];
          return (
            <div className="m-tile" key={label}>
              <span style={{ color: `var(--cat-${TILE_COLORS[i]})`, maxWidth: 'none' }}><Icon /></span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
      {c.shelves.slice(0, 2).map((shelf) => (
        <div key={shelf.title}>
          <div className="m-shelf-h">
            <div className="m-l">
              <i className="m-dot" style={{ background: `var(--cat-${shelf.slot})` }} />
              <span className="m-heading">{shelf.title}</span>
            </div>
            <span className="m-link">{c.seeAll}</span>
          </div>
          <div className="m-shelf">
            {shelf.items.map((s) => (
              <div className="m-card" key={s.key}>
                <div className="m-cover">
                  <Img src={coverSrc(s.key, 240)} w={240} h={360} eager={eager} />
                  <span className="m-tag m-sm m-glass">{s.minutes}</span>
                </div>
                <div className="m-ttl">{s.title}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div className="m-homefade" />
    <div className="m-mini">
      <div className="m-cover"><Img src={coverSrc(c.story.key, 240)} w={240} h={360} eager={eager} /></div>
      <div className="m-t">
        <b>{c.story.title}</b>
        <span><PulseOutlineIcon className="" />{c.narratedBy}</span>
      </div>
      <div className="m-pp"><PauseIcon /></div>
      <div className="m-prog"><i /></div>
    </div>
    <div className="m-tabs">
      {c.tabs.map((label, i) => {
        const Icon = TAB_ICONS[i];
        return (
          <div className={`m-tabbtn ${i === 0 ? 'm-on' : ''}`} key={label}>
            <span className="m-pill"><Icon /></span>
            {label}
          </div>
        );
      })}
    </div>
    <div className="m-gest" />
  </div>
);

const StoryScreen: React.FC<{ c: MockCopy; eager?: boolean }> = ({ c, eager }) => {
  const s = c.story;
  return (
    <div className="m-scr m-dt">
      <div className="m-topbar">
        <div className="m-iconbtn"><ChevronBackIcon /></div>
        <div className="m-r">
          <div className="m-iconbtn"><BookmarkOutlineIcon /></div>
          <div className="m-iconbtn"><EllipsisHorizontalIcon /></div>
        </div>
      </div>
      <div className="m-body">
        <div className="m-stage">
          <div className="m-glow" />
          <div className="m-cover"><Img src={coverSrc(s.key, 480)} w={480} h={720} eager={eager} /></div>
        </div>
        <h4>{s.title}</h4>
        <div className="m-tags">
          <span className="m-tag" style={{ background: 'var(--cat-uyku)', color: 'var(--on-cat)' }}>{s.category}</span>
          {s.tags.map((t) => <span className="m-tag" key={t}>{t}</span>)}
        </div>
        <p className="m-summary">{s.summary}</p>
        {s.machineNote && (
          <p className="m-note"><SparklesOutlineIcon className="" />{s.machineNote}</p>
        )}
        <div className="m-subhead">
          <span className="m-sub">{c.cardsTitle}</span>
          <span className="m-link">{c.seeAll}</span>
        </div>
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
      <div className="m-dock">
        <div className="m-sample"><PulseOutlineIcon /></div>
        <div className="m-btn-lg"><PlayIcon />{c.ctaOwn}</div>
      </div>
      <div className="m-gest" />
    </div>
  );
};

const PlayerScreen: React.FC<{ c: MockCopy; eager?: boolean }> = ({ c, eager }) => {
  const s = c.story;
  return (
    <div className="m-scr m-pl">
      <div className="m-glowbox">
        <Img className="m-glowimg" src={coverSrc(s.key, 240)} w={240} h={360} eager={eager} />
        <div className="m-glowfade" />
      </div>
      <div className="m-col">
        <div className="m-top">
          <div className="m-iconbtn m-glassy"><ChevronDownIcon /></div>
          <div className="m-cap"><small>{c.nowPlaying}</small><b>{s.shelf}</b></div>
          <div className="m-iconbtn m-glassy"><ListOutlineIcon /></div>
        </div>
        <div className="m-grow" />
        <div className="m-art"><Img src={coverSrc(s.key, 480)} w={480} h={720} eager={eager} /></div>
        <div className="m-grow" />
        <h4>{s.title}</h4>
        <div className="m-by"><i><PulseOutlineIcon /></i>{c.narratedBy}</div>
        <div className="m-grow" />
        <div className="m-seek"><div className="m-track"><i /></div><span className="m-knob" /></div>
        <div className="m-times"><span>{c.elapsed}</span><span>{c.remaining}</span></div>
        <div className="m-grow" />
        <div className="m-ctrls">
          <div className="m-smb"><SkipIcon /></div>
          <div className="m-big"><PauseIcon /></div>
          <div className="m-smb"><SkipIcon forward /></div>
        </div>
        <div className="m-grow" />
        <div className="m-opts">
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
      </div>
      <div className="m-gest" />
    </div>
  );
};

/**
 * A phone showing one app screen, rebuilt in HTML/CSS in the murekkep palette.
 * The device is 384 x 804 CSS px, scaled by `--s` (set it through `style` or a
 * class); the holder takes the scaled size so the layout around it is exact.
 */
export const Phone: React.FC<PhoneProps> = ({ screen, lang, label, eager, className, style }) => {
  const c = MOCK[lang];
  return (
    <figure className={`m-app m-holder ${className ?? ''}`} style={style} role="img" aria-label={label}>
      <div className="m-device" aria-hidden="true">
        <div className="m-shell" />
        <div className="m-side" style={{ top: 170, height: 70 }} />
        <div className="m-side" style={{ top: 260, height: 110 }} />
        <div className="m-well">
          {screen === 'home' && <HomeScreen c={c} eager={eager} />}
          {screen === 'story' && <StoryScreen c={c} eager={eager} />}
          {screen === 'player' && <PlayerScreen c={c} eager={eager} />}
          <StatusBar />
        </div>
        <div className="m-sheen" />
      </div>
    </figure>
  );
};

export default Phone;
