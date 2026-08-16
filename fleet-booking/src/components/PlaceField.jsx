import { useState, useEffect, useRef, useId } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';

/**
 * A place, chosen from Google's suggestions.
 *
 * The value is only ever a resolved place — typing "Kandy" and walking away
 * leaves the field unset, because a quote needs coordinates and a half-typed
 * string silently priced as something else is worse than an empty field.
 * Clearing the text clears the selection, so an edited field cannot keep
 * pointing at the place that was there before.
 *
 * Picking is two steps, and the second one is a network call: suggestions carry
 * only a `placeId`, and coordinates are fetched for the one the customer chose.
 * That is Google's billing model — resolving all six suggestions would cost six
 * times what resolving the choice does — so the field shows a brief spinner on
 * pick rather than resolving eagerly as the list is drawn.
 *
 * The session token ties every keystroke for one field plus that final lookup
 * into a single billed session. It is retired once a place is chosen, and a new
 * one starts if the customer edits the field again.
 */
export default function PlaceField({ label, value, onChange, placeholder, autoFocus, error, marker }) {
  const { t } = useT();
  const [text, setText] = useState(value?.label || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pickError, setPickError] = useState('');
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const session = useRef(newSession());
  const listId = useId();

  // Keep in step when the parent replaces the value (a cleared form, say).
  useEffect(() => {
    setText(value?.label || '');
  }, [value?.label, value?.lat, value?.lon]);

  // Debounced lookup. The abort matters as much as the delay: without it a slow
  // early response can land after a fast late one and repopulate the list with
  // suggestions for a prefix the customer has already typed past.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 3 || q === value?.label) {
      setResults([]);
      return undefined;
    }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { places } = await api.places(q, session.current, ctl.signal);
        setResults(places || []);
        setOpen(true);
        setActive(-1);
      } catch {
        // A failed lookup shows no suggestions rather than an error under the
        // field — the customer's next keystroke will try again anyway.
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [text, value?.label]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function pick(suggestion) {
    setText(suggestion.label);
    setResults([]);
    setOpen(false);
    setPickError('');
    setResolving(true);
    try {
      const { place } = await api.resolvePlace(suggestion.placeId, session.current);
      // The session ends with the details call it paid for; the next edit to
      // this field starts a fresh one.
      session.current = newSession();
      onChange({ ...place, placeId: suggestion.placeId });
    } catch (err) {
      setPickError(err.message || 'Could not locate that place.');
      onChange(null);
    } finally {
      setResolving(false);
    }
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const chosen = Boolean(value?.lat);
  const shownError = error || pickError;

  return (
    <div ref={boxRef} className="relative">
      {label && <label className="label">{label}</label>}
      <div className="relative">
        {marker && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">{marker}</span>
        )}
        <input
          className={`input pr-8 ${marker ? 'pl-8' : ''} ${
            shownError ? 'border-danger focus:border-danger focus:ring-danger/15' : ''
          }`}
          aria-invalid={Boolean(shownError)}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          onChange={(e) => {
            setText(e.target.value);
            setPickError('');
            if (chosen) onChange(null);
          }}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs">
          {loading || resolving ? <Spinner /> : chosen ? <span className="text-brand">✓</span> : null}
        </span>
      </div>

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-paper shadow-lg"
        >
          {results.map((r, i) => (
            <li key={r.placeId}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  i === active ? 'bg-brand-soft' : 'hover:bg-canvas'
                }`}
              >
                <span className="block font-medium text-ink-900">{r.label}</span>
                <span className="block truncate text-xs text-ink-500">{r.full}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {shownError ? (
        <p className="mt-1 text-xs text-danger">{shownError}</p>
      ) : (
        text.trim().length >= 3 &&
        !chosen &&
        !loading &&
        !resolving &&
        !open && (
          <p className="mt-1 text-xs text-ink-500">
            {results.length === 0 ? t('place.noMatch') : t('place.pickFromList')}
          </p>
        )
      )}
    </div>
  );
}

/**
 * A session token: any opaque, unique string. `randomUUID` is unavailable on
 * pages served over plain HTTP, which is exactly what a phone on the local
 * network hits during development, so there is a fallback.
 */
function newSession() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-ink-400" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
