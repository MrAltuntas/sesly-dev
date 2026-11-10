import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { getActionAuth } from '../lib/firebaseAuth';
import { APP_CONFIG } from '../constants';
import {
  AlertCircleOutlineIcon,
  CheckmarkIcon,
  ChevronBackIcon,
  LockClosedOutlineIcon,
  MailOutlineIcon,
  TimeOutlineIcon,
} from '../components/Icons';

/**
 * Firebase email action handler (the "action URL" of the Firebase Auth email
 * templates): https://sesly.io/auth/action?mode=...&oobCode=...&lang=...
 *
 * Handles resetPassword, verifyEmail and recoverEmail. The page is noindex,
 * sends no referrer and never logs or stores the oobCode. The copy lives here
 * in both languages; `lang` comes from the link (the app sets the Firebase
 * language to its UI language), else the browser, else Turkish.
 */

type Lang = 'tr' | 'en';
type Mode = 'resetPassword' | 'verifyEmail' | 'recoverEmail';
type Problem =
  | 'missing'
  | 'config'
  | 'expired'
  | 'invalid'
  | 'disabled'
  | 'notFound'
  | 'network'
  | 'tooMany'
  | 'unknown';

type View =
  | { kind: 'loading' }
  | { kind: 'problem'; problem: Problem }
  | { kind: 'resetForm'; email: string }
  | { kind: 'resetDone' }
  | { kind: 'verifyDone' }
  | { kind: 'recoverDone'; email: string };

const MIN_PASSWORD_LENGTH = 6;
const MODES: readonly Mode[] = ['resetPassword', 'verifyEmail', 'recoverEmail'];

const COPY = {
  tr: {
    metaTitle: 'Hesap işlemi - Sesly',
    backHome: 'Ana sayfaya dön',
    loading: 'Bağlantı kontrol ediliyor...',
    resetTitle: 'Yeni şifre belirle',
    resetIntro: (email: string) => `${email} hesabı için yeni bir şifre seç.`,
    newPassword: 'Yeni şifre',
    repeatPassword: 'Yeni şifre (tekrar)',
    passwordHint: `En az ${MIN_PASSWORD_LENGTH} karakter.`,
    show: 'Göster',
    hide: 'Gizle',
    showLabel: 'Şifreyi göster',
    hideLabel: 'Şifreyi gizle',
    tooShort: `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`,
    mismatch: 'Şifreler eşleşmiyor.',
    weak: 'Bu şifre yeterince güçlü değil. Daha uzun ya da harf, rakam ve işaret karışık bir şifre seç.',
    submit: 'Şifreyi değiştir',
    submitting: 'Kaydediliyor...',
    resetDoneTitle: 'Şifren değişti',
    resetDoneBody: 'Sesly uygulamasına dön ve e-posta adresin ile yeni şifrenle giriş yap.',
    verifyDoneTitle: 'E-posta adresin doğrulandı',
    verifyDoneBody: 'Teşekkürler. Sesly uygulamasına dönüp kaldığın yerden devam edebilirsin.',
    recoverDoneTitle: 'E-posta adresin geri alındı',
    recoverDoneBody: (email: string) =>
      `Hesabının giriş e-postası yeniden ${email} oldu. Bu değişikliği sen istemediysen şifreni de değiştirmeni öneririz.`,
    recoverSend: 'Şifre sıfırlama e-postası gönder',
    recoverSending: 'Gönderiliyor...',
    recoverSent: (email: string) => `Şifre sıfırlama bağlantısı ${email} adresine gönderildi.`,
    recoverSendFailed: 'E-posta gönderilemedi. Biraz sonra tekrar dene.',
    continue: 'Devam et',
    retry: 'Tekrar dene',
    problems: {
      missing: {
        title: 'Bağlantı eksik',
        body: 'Bu sayfa Sesly e-postasındaki bağlantıyla açılır. Bağlantıyı e-postadan yeniden aç ya da tamamını kopyaladığından emin ol.',
      },
      config: {
        title: 'Bu işlem şu an yapılamıyor',
        body: `Biraz sonra tekrar dene. Sorun sürerse ${APP_CONFIG.contactEmail} adresine yaz.`,
      },
      expired: {
        title: 'Bağlantının süresi dolmuş',
        body: 'Bu bağlantı artık geçerli değil. Sesly uygulamasından yeni bir bağlantı iste.',
      },
      invalid: {
        title: 'Bağlantı geçersiz',
        body: 'Bu bağlantı daha önce kullanılmış ya da eksik kopyalanmış olabilir. Gerekirse Sesly uygulamasından yeni bir bağlantı iste.',
      },
      disabled: {
        title: 'Hesap devre dışı',
        body: `Bu hesap devre dışı bırakılmış. Yardım için ${APP_CONFIG.contactEmail} adresine yaz.`,
      },
      notFound: {
        title: 'Hesap bulunamadı',
        body: 'Bu bağlantının ait olduğu hesap artık yok. Hesabın silinmiş olabilir.',
      },
      network: {
        title: 'Bağlantı kurulamadı',
        body: 'İnternet bağlantını kontrol edip tekrar dene.',
      },
      tooMany: {
        title: 'Çok fazla deneme',
        body: 'Kısa sürede çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.',
      },
      unknown: {
        title: 'Bir şeyler ters gitti',
        body: `Biraz sonra tekrar dene. Sorun sürerse ${APP_CONFIG.contactEmail} adresine yaz.`,
      },
    },
    resetHelp: 'Yeni bağlantı için uygulamada giriş ekranındaki "Şifremi unuttum" adımını kullan.',
  },
  en: {
    metaTitle: 'Account action - Sesly',
    backHome: 'Back to home',
    loading: 'Checking the link...',
    resetTitle: 'Choose a new password',
    resetIntro: (email: string) => `Pick a new password for ${email}.`,
    newPassword: 'New password',
    repeatPassword: 'New password (again)',
    passwordHint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
    show: 'Show',
    hide: 'Hide',
    showLabel: 'Show password',
    hideLabel: 'Hide password',
    tooShort: `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
    mismatch: 'The passwords do not match.',
    weak: 'This password is not strong enough. Choose a longer one or mix letters, digits and symbols.',
    submit: 'Change password',
    submitting: 'Saving...',
    resetDoneTitle: 'Your password has changed',
    resetDoneBody: 'Go back to the Sesly app and sign in with your email address and your new password.',
    verifyDoneTitle: 'Your email address is verified',
    verifyDoneBody: 'Thank you. You can go back to the Sesly app and carry on.',
    recoverDoneTitle: 'Your email address is restored',
    recoverDoneBody: (email: string) =>
      `The sign-in email of your account is ${email} again. If you did not ask for the change, we recommend changing your password too.`,
    recoverSend: 'Send a password reset email',
    recoverSending: 'Sending...',
    recoverSent: (email: string) => `A password reset link was sent to ${email}.`,
    recoverSendFailed: 'The email could not be sent. Try again in a moment.',
    continue: 'Continue',
    retry: 'Try again',
    problems: {
      missing: {
        title: 'The link is incomplete',
        body: 'This page opens from the link in a Sesly email. Open the link from the email again, or make sure you copied all of it.',
      },
      config: {
        title: 'This cannot be done right now',
        body: `Try again in a moment. If it keeps happening, write to ${APP_CONFIG.contactEmail}.`,
      },
      expired: {
        title: 'The link has expired',
        body: 'This link is no longer valid. Ask for a new one in the Sesly app.',
      },
      invalid: {
        title: 'The link is not valid',
        body: 'This link may have been used already or copied only in part. If needed, ask for a new one in the Sesly app.',
      },
      disabled: {
        title: 'Account disabled',
        body: `This account has been disabled. For help, write to ${APP_CONFIG.contactEmail}.`,
      },
      notFound: {
        title: 'Account not found',
        body: 'The account this link belongs to no longer exists. It may have been deleted.',
      },
      network: {
        title: 'Could not connect',
        body: 'Check your internet connection and try again.',
      },
      tooMany: {
        title: 'Too many attempts',
        body: 'There were too many attempts in a short time. Wait a little and try again.',
      },
      unknown: {
        title: 'Something went wrong',
        body: `Try again in a moment. If it keeps happening, write to ${APP_CONFIG.contactEmail}.`,
      },
    },
    resetHelp: 'For a new link, use "Forgot password?" on the sign-in screen of the app.',
  },
} as const;

type Copy = (typeof COPY)[Lang];

function toLang(value: string | null | undefined): Lang | null {
  const v = (value || '').toLowerCase();
  if (v.startsWith('tr')) return 'tr';
  if (v.startsWith('en')) return 'en';
  return null;
}

function resolveLang(param: string | null): Lang {
  const fromLink = toLang(param);
  if (fromLink) return fromLink;
  if (typeof navigator !== 'undefined') {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const item of list) {
      const lang = toLang(item);
      if (lang) return lang;
    }
  }
  return 'tr';
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

function problemOf(error: unknown): Problem {
  switch (errorCode(error)) {
    case 'auth/expired-action-code':
      return 'expired';
    case 'auth/invalid-action-code':
    case 'auth/argument-error':
      return 'invalid';
    case 'auth/user-disabled':
      return 'disabled';
    case 'auth/user-not-found':
      return 'notFound';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/too-many-requests':
      return 'tooMany';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'config';
    default:
      return 'unknown';
  }
}

/** Problems worth a retry button (the code may still be good). */
const RETRYABLE: ReadonlySet<Problem> = new Set<Problem>(['network', 'tooMany', 'unknown']);

/**
 * A continue link is only offered for an https URL on sesly.io (or this
 * origin), so a crafted link cannot turn the page into an open redirect.
 */
function safeContinueUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.origin === window.location.origin) return url.toString();
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'sesly.io' || host.endsWith('.sesly.io')) return url.toString();
  } catch {
    // not a URL
  }
  return null;
}

/**
 * One request per (mode, code). React StrictMode runs effects twice in
 * development, and applyActionCode only succeeds once, so every run of the
 * effect awaits the same promise. Retry drops the entry first.
 */
const pending = new Map<string, Promise<View>>();

function runOnce(key: string, task: () => Promise<View>): Promise<View> {
  let promise = pending.get(key);
  if (!promise) {
    promise = task();
    pending.set(key, promise);
  }
  return promise;
}

const AuthAction: React.FC = () => {
  const [params] = useSearchParams();
  const { i18n } = useTranslation();

  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  const linkApiKey = params.get('apiKey');
  const continueUrl = useMemo(() => safeContinueUrl(params.get('continueUrl')), [params]);

  // The link language wins on arrival and is handed to the header and footer.
  // After that the page follows the site's language switch.
  const [initialLang] = useState<Lang>(() => resolveLang(params.get('lang')));
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    const current = toLang(i18n.language) ?? 'tr';
    if (current === initialLang) {
      setSynced(true);
      return;
    }
    void i18n.changeLanguage(initialLang).finally(() => setSynced(true));
    // Only on arrival: after that the header switch drives the language.
  }, []);
  const lang: Lang = synced ? (toLang(i18n.language) ?? initialLang) : initialLang;
  const copy = COPY[lang];

  const auth = useMemo(() => getActionAuth(linkApiKey), [linkApiKey]);
  useEffect(() => {
    if (auth) auth.languageCode = lang;
  }, [auth, lang]);

  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const validMode = MODES.includes(mode as Mode) ? (mode as Mode) : null;

  useEffect(() => {
    if (!validMode || !oobCode) {
      setView({ kind: 'problem', problem: 'missing' });
      return;
    }
    if (!auth) {
      setView({ kind: 'problem', problem: 'config' });
      return;
    }

    let cancelled = false;
    setView({ kind: 'loading' });

    const key = `${validMode}:${oobCode}:${attempt}`;
    const task = async (): Promise<View> => {
      try {
        if (validMode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, oobCode);
          return { kind: 'resetForm', email };
        }
        if (validMode === 'verifyEmail') {
          await applyActionCode(auth, oobCode);
          return { kind: 'verifyDone' };
        }
        const info = await checkActionCode(auth, oobCode);
        await applyActionCode(auth, oobCode);
        return { kind: 'recoverDone', email: info.data.email ?? '' };
      } catch (error) {
        return { kind: 'problem', problem: problemOf(error) };
      }
    };

    void runOnce(key, task).then((next) => {
      if (!cancelled) setView(next);
    });

    return () => {
      cancelled = true;
    };
  }, [auth, validMode, oobCode, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="py-10 md:py-16">
      <Helmet>
        <html lang={lang} />
        <title>{copy.metaTitle}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Helmet>

      <div className="wrap max-w-[560px]">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-sm py-1 pr-2 text-[15px] font-extrabold text-text2 transition-colors hover:text-text"
        >
          <ChevronBackIcon className="h-5 w-5" />
          {copy.backHome}
        </Link>

        <div className="card mt-5 px-5 py-8 sm:px-10 sm:py-10" lang={lang} aria-live="polite">
          {view.kind === 'loading' && <Loading copy={copy} />}

          {view.kind === 'problem' && (
            <Message
              tone={view.problem === 'expired' ? 'time' : 'error'}
              title={copy.problems[view.problem].title}
              body={copy.problems[view.problem].body}
              extra={
                validMode === 'resetPassword' &&
                (view.problem === 'expired' || view.problem === 'invalid')
                  ? copy.resetHelp
                  : undefined
              }
            >
              {RETRYABLE.has(view.problem) && (
                <button type="button" className="btn btn-md btn-secondary mt-6" onClick={retry}>
                  {copy.retry}
                </button>
              )}
            </Message>
          )}

          {view.kind === 'resetForm' && auth && oobCode && (
            <ResetForm
              copy={copy}
              email={view.email}
              onConfirm={(password) => confirmPasswordReset(auth, oobCode, password)}
              onDone={() => setView({ kind: 'resetDone' })}
              onFatal={(problem) => setView({ kind: 'problem', problem })}
            />
          )}

          {view.kind === 'resetDone' && (
            <Message tone="success" title={copy.resetDoneTitle} body={copy.resetDoneBody}>
              {continueUrl && <ContinueLink href={continueUrl} label={copy.continue} />}
            </Message>
          )}

          {view.kind === 'verifyDone' && (
            <Message tone="success" title={copy.verifyDoneTitle} body={copy.verifyDoneBody}>
              {continueUrl && <ContinueLink href={continueUrl} label={copy.continue} />}
            </Message>
          )}

          {view.kind === 'recoverDone' && auth && (
            <Message tone="mail" title={copy.recoverDoneTitle} body={copy.recoverDoneBody(view.email)}>
              {view.email && <RecoverReset copy={copy} email={view.email} send={() => sendPasswordResetEmail(auth, view.email)} />}
            </Message>
          )}
        </div>
      </div>
    </div>
  );
};

const Loading: React.FC<{ copy: Copy }> = ({ copy }) => (
  <div role="status" className="animate-pulse">
    <div className="h-14 w-14 rounded-pill bg-surface2" />
    <div className="mt-6 h-7 w-2/3 rounded-xs bg-surface2" />
    <div className="mt-4 h-3.5 w-full rounded-xs bg-surface2" />
    <div className="mt-3 h-3.5 w-10/12 rounded-xs bg-surface2" />
    <span className="sr-only">{copy.loading}</span>
  </div>
);

type Tone = 'success' | 'error' | 'time' | 'mail';

const TONE_ICON: Record<Tone, { Icon: React.FC<{ className?: string }>; color: string }> = {
  success: { Icon: CheckmarkIcon, color: 'text-action' },
  error: { Icon: AlertCircleOutlineIcon, color: 'text-error' },
  time: { Icon: TimeOutlineIcon, color: 'text-warning' },
  mail: { Icon: MailOutlineIcon, color: 'text-uyku' },
};

const Message: React.FC<{
  tone: Tone;
  title: string;
  body: string;
  extra?: string;
  children?: React.ReactNode;
}> = ({ tone, title, body, extra, children }) => {
  const { Icon, color } = TONE_ICON[tone];
  return (
    <div role={tone === 'error' ? 'alert' : undefined}>
      <div className={`flex h-14 w-14 items-center justify-center rounded-pill bg-surface2 shadow-lip-sm ${color}`}>
        <Icon className="h-7 w-7" />
      </div>
      <h1 className="mt-6 text-[30px] leading-[1.25] text-text sm:text-[36px]">{title}</h1>
      <p className="lead mt-3">{body}</p>
      {extra && <p className="mt-4 rounded-md bg-surface2 p-4 text-[15px] leading-relaxed text-text2">{extra}</p>}
      {children}
    </div>
  );
};

const ContinueLink: React.FC<{ href: string; label: string }> = ({ href, label }) => (
  <a href={href} rel="noreferrer" className="btn btn-md btn-primary mt-6">
    {label}
  </a>
);

const inputClass =
  'h-12 w-full rounded-md border border-line bg-surface2 px-4 text-[16px] text-text placeholder:text-text3 ' +
  'transition-colors focus:border-action focus:outline-none aria-[invalid=true]:border-error';

const ResetForm: React.FC<{
  copy: Copy;
  email: string;
  onConfirm: (password: string) => Promise<void>;
  onDone: () => void;
  onFatal: (problem: Problem) => void;
}> = ({ copy, email, onConfirm, onDone, onFatal }) => {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const lengthError = password.length < MIN_PASSWORD_LENGTH ? copy.tooShort : null;
  const repeatError = !lengthError && repeat !== password ? copy.mismatch : null;
  const showLength = attempted && !!lengthError;
  const showRepeat = attempted && !!repeatError;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setAttempted(true);
    setFormError(null);
    if (lengthError || repeatError) return;

    setSubmitting(true);
    try {
      await onConfirm(password);
      onDone();
    } catch (error) {
      const code = errorCode(error);
      if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
        setFormError(copy.weak);
      } else {
        const problem = problemOf(error);
        if (RETRYABLE.has(problem)) setFormError(copy.problems[problem].body);
        else onFatal(problem);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex h-14 w-14 items-center justify-center rounded-pill bg-surface2 text-action shadow-lip-sm">
        <LockClosedOutlineIcon className="h-7 w-7" />
      </div>
      <h1 className="mt-6 text-[30px] leading-[1.25] text-text sm:text-[36px]">{copy.resetTitle}</h1>
      <p className="lead mt-3 break-words">{copy.resetIntro(email)}</p>

      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

      <div className="mt-8 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="new-password" className="text-[15px] font-extrabold text-text">
              {copy.newPassword}
            </label>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-pressed={visible}
              aria-label={visible ? copy.hideLabel : copy.showLabel}
              className="rounded-xs px-1 text-[14px] font-extrabold text-text2 transition-colors hover:text-text"
            >
              {visible ? copy.hide : copy.show}
            </button>
          </div>
          <input
            ref={firstRef}
            id="new-password"
            name="new-password"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFormError(null);
            }}
            aria-invalid={showLength}
            aria-describedby="new-password-hint"
            className={`${inputClass} mt-2`}
          />
          <p
            id="new-password-hint"
            className={`mt-2 text-[14px] ${showLength ? 'text-error' : 'text-text3'}`}
          >
            {showLength ? lengthError : copy.passwordHint}
          </p>
        </div>

        <div>
          <label htmlFor="repeat-password" className="text-[15px] font-extrabold text-text">
            {copy.repeatPassword}
          </label>
          <input
            id="repeat-password"
            name="repeat-password"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
              setFormError(null);
            }}
            aria-invalid={showRepeat}
            aria-describedby={showRepeat ? 'repeat-password-error' : undefined}
            className={`${inputClass} mt-2`}
          />
          {showRepeat && (
            <p id="repeat-password-error" className="mt-2 text-[14px] text-error">
              {repeatError}
            </p>
          )}
        </div>
      </div>

      {formError && (
        <p role="alert" className="mt-6 flex gap-3 rounded-md bg-surface2 p-4 text-[15px] text-text2">
          <AlertCircleOutlineIcon className="mt-0.5 h-5 w-5 flex-none text-error" />
          <span>{formError}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn btn-lg btn-primary mt-8 w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? copy.submitting : copy.submit}
      </button>
    </form>
  );
};

const RecoverReset: React.FC<{ copy: Copy; email: string; send: () => Promise<void> }> = ({
  copy,
  email,
  send,
}) => {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const onClick = async () => {
    if (state === 'sending' || state === 'sent') return;
    setState('sending');
    try {
      await send();
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  if (state === 'sent') {
    return (
      <p className="mt-6 flex gap-3 rounded-md bg-surface2 p-4 text-[15px] text-text2" role="status">
        <CheckmarkIcon className="mt-0.5 h-5 w-5 flex-none text-action" />
        <span className="break-words">{copy.recoverSent(email)}</span>
      </p>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'sending'}
        className="btn btn-md btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === 'sending' ? copy.recoverSending : copy.recoverSend}
      </button>
      {state === 'failed' && (
        <p role="alert" className="mt-3 text-[14px] text-error">
          {copy.recoverSendFailed}
        </p>
      )}
    </div>
  );
};

export default AuthAction;
