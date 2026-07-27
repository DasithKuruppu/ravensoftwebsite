/**
 * Loading indicator.
 *
 * Used where an empty result and a not-yet-loaded result look identical — the
 * daily log showed "No entries this month yet" while it was still fetching,
 * which reads as an answer rather than a wait.
 */
export default function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-3 py-8 text-slate-400 ${className}`}>
      <span
        className="inline-block w-4 h-4 rounded-full border-2 border-ink-600 border-t-accent animate-spin"
        role="status"
        aria-label={label}
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Dimming overlay for content that is being refreshed in place. */
export function Refreshing({ active, children }) {
  return (
    <div className="relative">
      <div className={active ? 'opacity-40 transition-opacity pointer-events-none' : 'transition-opacity'}>
        {children}
      </div>
      {active && (
        <div className="absolute inset-0 grid place-items-center">
          <span
            className="inline-block w-5 h-5 rounded-full border-2 border-ink-600 border-t-accent animate-spin"
            role="status"
            aria-label="Refreshing"
          />
        </div>
      )}
    </div>
  );
}
