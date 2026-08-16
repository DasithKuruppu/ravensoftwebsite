/**
 * The React face of `i18n.js`: a provider that re-renders the tree when the
 * language changes, and the two hooks components actually call.
 *
 * Deliberately usable without the provider. Several components are rendered
 * straight to a string in the tests, and a `useT()` that threw outside a
 * provider would mean wrapping every one of them for no behavioural gain — the
 * locale lives in the module either way, so an unwrapped component still reads
 * the right language.
 */
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  cloneElement,
  isValidElement,
} from 'react';
import { getLocale, setLocale, subscribe, translate, parts, LOCALES } from './i18n.js';

const LocaleContext = createContext(null);

export function I18nProvider({ children }) {
  // The store is the module, not this component: `format.js` reads the same
  // value without going through React at all.
  const locale = useSyncExternalStore(subscribe, getLocale, () => getLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The active locale, and the setter for the switch in the header. */
export function useLocale() {
  const fromContext = useContext(LocaleContext);
  return [fromContext ?? getLocale(), setLocale];
}

/**
 * `t` for plain strings, `tx` for sentences with React nodes in them.
 *
 * Both are re-created when the locale changes, which is what makes a component
 * that only calls `t()` still re-render on a language switch.
 */
export function useT() {
  const [locale] = useLocale();
  return {
    locale,
    t: (key, vars) => translate(key, vars, locale),
    tx: (key, vars) =>
      parts(key, vars, locale).map((part, i) =>
        isValidElement(part) ? cloneElement(part, { key: i }) : part,
      ),
  };
}

/**
 * The language switch itself.
 *
 * Two letters in the header rather than a select: there are two languages, and a
 * dropdown for two options is a tap and a decision where a toggle is a tap.
 */
export function LanguageToggle({ className = '' }) {
  const [locale, set] = useLocale();
  return (
    <div className={`flex items-center overflow-hidden rounded-lg border border-line ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => set(l.code)}
          aria-label={l.name}
          aria-pressed={locale === l.code}
          className={`px-2 py-1 text-xs leading-4 transition ${
            locale === l.code
              ? 'bg-brand-soft font-medium text-brand-dark'
              : 'text-ink-500 hover:text-ink-900'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export { getLocale, setLocale, LOCALES } from './i18n.js';
