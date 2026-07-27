import { useState } from 'react';
import { api } from '../api.js';
import { money, amount, count, dayLabel, todayLocal } from '../format.js';
import { cashPocket } from '../display.js';

/**
 * The month's money in, and what is still in the driver's pocket.
 *
 * ONE card for all of it. The same rupees used to be described on two: a "cash vs
 * bank" card that split the month's takings, and a "cash pocket" card that
 * tracked the balance — so the screen said the same thing twice under two
 * headings, and neither card could be reconciled without adding rows across both.
 * Everything about money arriving and money going back now lives here, in the
 * order it happens: what came in, how it came in, what has gone back, what is
 * left.
 *
 * Cash fares never reach the bank, so by the end of a month the driver is
 * carrying a large amount of somebody else's money and neither party has a
 * number for it. The handover then becomes a negotiation between two memories.
 * One running figure, visible to both of them, makes it a formality instead.
 *
 * The division of powers is the feature, not an obstacle to it: he logs a
 * handover because he is the one handing money over, the owner confirms because
 * he is the one receiving it, and only a confirmed handover moves the balance.
 * A pending entry is money one person says moved and the other has not
 * acknowledged — which is exactly what an unwitnessed handover is.
 *
 * Whole rupees, like everything else the driver reads. The ledger and the store
 * keep the exact figures — a handover of 31,938.03 is stored to the cent and
 * settles to the cent — but nobody counts out three cents at a handover, and the
 * decimals cost two glyphs on every line of the densest card on the screen.
 */
export default function CashPocket({ summary, hero, onChange, voice = 'driver' }) {
  const pocket = cashPocket(summary, hero);
  const [logging, setLogging] = useState(false);
  if (!pocket) return null;

  const driver = voice === 'driver';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label">
          {driver ? 'Your cash' : `${summary.driverName || 'Driver'} cash`}
        </h2>
        {driver && !logging && (
          <button
            onClick={() => setLogging(true)}
            className="text-xs text-slate-300 underline underline-offset-2"
          >
            Log handover
          </button>
        )}
      </div>

      {logging ? (
        <HandoverForm
          onCancel={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            onChange?.();
          }}
        />
      ) : (
        <>
          {/* How the month's takings arrived. One bar, split where the cash ends
              — the proportion is the point, and it is the same figure the rows
              below are struck from. */}
          {pocket.cashKnown && pocket.totalIn > 0 && (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-ink-950 border border-ink-700 mt-3">
                <div className="bg-warn/70" style={{ width: `${pocket.cashPctOfTakings}%` }} />
                <div className="flex-1 bg-slate-400/60" />
              </div>
              <dl className="mt-3 space-y-2">
                <Row
                  icon={<CashIcon />}
                  label="Cash you collected"
                  hint={
                    pocket.cashPctOfTakings > 0
                      ? `${pocket.cashPctOfTakings}% of the month's fares`
                      : 'no cash fares recorded yet'
                  }
                  value={money(pocket.cashIn)}
                  tone="text-warn"
                />
                <Row
                  icon={<BankIcon />}
                  label="Paid to the bank by Uber"
                  hint="never passes through your hands"
                  value={money(pocket.bankIn)}
                  tone="text-slate-100"
                />
                <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2">
                  <dt className="text-sm font-medium text-slate-200">Cash + bank</dt>
                  <dd className="num text-slate-100 shrink-0">{money(pocket.totalIn)}</dd>
                </div>
                <p className="text-xs text-slate-400">all fares this month</p>
              </dl>
            </>
          )}

          {!pocket.cashKnown && (
            <p className="text-sm text-slate-300 mt-3">
              No cash figures yet. Import a payments export with the “Cash collected” column, or
              type the day's cash into the daily log.
            </p>
          )}

          <dl className={`space-y-2 ${pocket.cashKnown ? 'mt-4 pt-3 border-t border-ink-700' : 'mt-3'}`}>
            {/* Two states, because a subtraction with nothing taken off it is not
                worth three rows. Until a handover has been confirmed, holding IS
                the cash collected and one line says so; after that the working is
                worth showing, because the driver wants to see his handover
                counted and the owner wants to see what is left. */}
            {pocket.hasHandedOver ? (
              <>
                <Row label="Collected" hint="cash fares this month" value={money(pocket.cashIn)} />
                <Row
                  label="Handed over"
                  hint="confirmed by the owner"
                  value={`− ${money(pocket.handedOver)}`}
                  tone="text-slate-100"
                />
                <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2">
                  <dt className="text-sm font-medium text-slate-200">Holding now</dt>
                  <dd className="num text-warn shrink-0">{money(pocket.holding)}</dd>
                </div>
              </>
            ) : (
              <Row
                label="Holding now"
                hint="every cash fare so far — nothing handed over yet"
                value={money(pocket.holding)}
                tone="text-warn"
              />
            )}
            <Row
              label="By tonight (est.)"
              hint={
                pocket.cashSharePct === null
                  ? 'once there is a cash history to go on'
                  : `today's target × ${pocket.cashSharePct}% cash ${basisLabel(pocket.cashShareBasis)}`
              }
              value={money(pocket.byTonight)}
            />
            <Row
              label={
                pocket.owedToOwner
                  ? driver
                    ? 'You hand over (est.)'
                    : 'Driver hands over (est.)'
                  : driver
                    ? 'Owner owes you (est.)'
                    : `You owe ${summary.driverName || 'the driver'} (est.)`
              }
              hint="the month in total, on this pace"
              value={money(pocket.settlement)}
              tone={pocket.owedToOwner ? 'text-warn' : 'text-accent'}
            />
            {/* What is still outstanding. Without it the gross figure reads as
                money still owed even after most of it has been handed over. */}
            {pocket.confirmed > 0 && pocket.owedToOwner && (
              <Row
                label="Still to hand over (est.)"
                hint={`${money(pocket.confirmed)} handed over so far`}
                value={money(Math.max(0, pocket.leftToSettle))}
                tone="text-warn"
              />
            )}
            {pocket.pending > 0 && (
              <Row
                label="Pending confirmation"
                hint="not off your balance until the owner confirms"
                value={money(pocket.pending)}
                tone="text-slate-400"
              />
            )}
          </dl>

          <Ledger
            pocket={pocket}
            canConfirm={!driver}
            canWithdraw={driver}
            onChange={onChange}
          />
        </>
      )}
    </div>
  );
}

/** Logging a handover: an amount, a date, and a note if it needs one. */
function HandoverForm({ onCancel, onSaved }) {
  const [form, setForm] = useState({ amount: '', date: todayLocal(), note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.logHandover({
        amount: Number(form.amount),
        date: form.date,
        note: form.note.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <p className="text-xs text-slate-400">
        It comes off your balance once the owner confirms it. Until then it shows as pending to both
        of you.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-slate-400">Amount handed over</span>
          <input
            type="number"
            step="100"
            min="0"
            inputMode="decimal"
            autoFocus
            className="num w-full"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </label>
        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-slate-400">Date</span>
          <input
            type="date"
            className="w-full"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-[11px] text-slate-400">Note (optional)</span>
        <input
          className="w-full"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="handed to owner at the office"
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || !Number(form.amount)}>
          {busy ? 'Saving…' : 'Log it'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The ledger, newest first. Both roles see all of it — a history only one party
 * can read is not a reconciliation.
 */
function Ledger({ pocket, canConfirm, canWithdraw, onChange }) {
  const [busy, setBusy] = useState(null);
  if (!pocket.ledger.length) {
    return (
      <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-ink-700">
        Nothing handed over yet this month.
      </p>
    );
  }

  async function act(fn, id) {
    setBusy(id);
    try {
      await fn();
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-ink-700">
      <div className="label mb-2">Handovers</div>
      <dl className="space-y-2">
        {pocket.ledger.map((h) => (
          <div key={h.id} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-slate-300 min-w-0">
              {dayLabel(h.date)}
              <span className="block text-xs text-slate-400">
                {h.confirmed ? 'confirmed' : 'pending'}
                {h.note ? ` · ${h.note}` : ''}
              </span>
            </dt>
            <dd className="shrink-0 text-right">
              <span className={`num ${h.confirmed ? 'text-slate-100' : 'text-slate-400'}`}>
                {money(h.amount)}
              </span>
              {/* One tap for the owner; a confirmed entry is a receipt and stays. */}
              {canConfirm && !h.confirmed && (
                <button
                  className="btn text-xs px-2 py-0.5 ml-2"
                  disabled={busy === h.id}
                  onClick={() => act(() => api.confirmHandover(h.id), h.id)}
                >
                  Confirm
                </button>
              )}
              {canWithdraw && !h.confirmed && h.loggedBy === 'driver' && (
                <button
                  className="btn btn-danger text-xs px-2 py-0.5 ml-2"
                  disabled={busy === h.id}
                  onClick={() => act(() => api.deleteHandover(h.id), h.id)}
                >
                  Withdraw
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Where the cash share came from, so an estimate says how well founded it is. */
function basisLabel(basis) {
  if (basis === '30d') return 'over 30 days';
  if (basis === 'month') return 'this month';
  return '(assumed — no history yet)';
}

function Row({ icon, label, hint, value, tone = 'text-slate-100' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-300 min-w-0 flex items-start gap-2.5">
        {/* The icon carries the meaning at a glance and is tinted to match its
            segment of the bar, so a separate colour key would be noise. */}
        {icon && <span className={`shrink-0 mt-0.5 ${tone}`}>{icon}</span>}
        <span>
          {label}
          {hint && <span className="block text-xs text-slate-400">{hint}</span>}
        </span>
      </dt>
      <dd className={`num shrink-0 ${tone}`}>{value}</dd>
    </div>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/** Banknote — physical cash in the driver's hand. */
function CashIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

/** Bank — money that lands in the company account. */
function BankIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10h18M12 3 3 8h18z" />
      <path d="M6 10v7M10 10v7M14 10v7M18 10v7" />
      <path d="M3 20h18" />
    </svg>
  );
}

/**
 * The owner's one-line version, for the month view: what came in as cash, what is
 * owed, and which way the difference goes.
 */
export function SettlementLine({ summary }) {
  const cash = summary?.cash;
  if (!cash) return null;
  const owed = cash.settlement >= 0;
  return (
    <p className="text-xs text-slate-300">
      cash <span className="num text-slate-100">{amount(cash.collected)}</span> · pay{' '}
      <span className="num text-slate-100">{amount(summary.driverPay)}</span> ·{' '}
      {owed ? 'driver hands over' : 'owner owes'}{' '}
      <span className={`num ${owed ? 'text-warn' : 'text-accent'}`}>
        {amount(Math.abs(cash.settlement))}
      </span>
      {cash.pending > 0 && (
        <>
          {' · '}
          <span className="num text-slate-400">{count(cash.handovers.filter((h) => !h.confirmed).length)} pending</span>
        </>
      )}
    </p>
  );
}
