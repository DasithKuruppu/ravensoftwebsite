import { useState } from 'react';
import { api } from '../api.js';
import { money, amount, count, dayLabel, todayLocal } from '../format.js';
import { cashPocket, driverNameIn } from '../display.js';
import { useT } from '../i18n/index.jsx';

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
  const { t } = useT();
  const pocket = cashPocket(summary, hero);
  const [logging, setLogging] = useState(false);
  if (!pocket) return null;

  const driver = voice === 'driver';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label">
          {driver
            ? t('cash.heading')
            : t('cash.headingOwner', { name: driverNameIn(summary) || t('cash.driver') })}
        </h2>
        {driver && !logging && (
          <button
            onClick={() => setLogging(true)}
            className="text-xs text-slate-300 underline underline-offset-2"
          >
            {t('cash.logHandover')}
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
                  label={t('cash.collected')}
                  hint={
                    pocket.cashPctOfTakings > 0
                      ? t('cash.collectedHint', { pct: pocket.cashPctOfTakings })
                      : t('cash.noCashYet')
                  }
                  value={money(pocket.cashIn)}
                  tone="text-warn"
                />
                <Row
                  icon={<BankIcon />}
                  label={t('cash.bank')}
                  // The same sentence as the cash row, against the bar's other
                  // half: two shares of one month read against each other, where
                  // a sentence about hands did not compare to anything.
                  hint={t('cash.collectedHint', { pct: 100 - pocket.cashPctOfTakings })}
                  value={money(pocket.bankIn)}
                  tone="text-slate-100"
                />
                <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2">
                  <dt className="text-sm font-medium text-slate-200">{t('cash.cashPlusBank')}</dt>
                  <dd className="num text-slate-100 shrink-0">{money(pocket.totalIn)}</dd>
                </div>
                <p className="text-xs text-slate-400">{t('cash.allFares')}</p>
              </dl>
            </>
          )}

          {!pocket.cashKnown && (
            <p className="text-sm text-slate-300 mt-3 leading-relaxed">{t('cash.noFigures')}</p>
          )}

          <dl className={`space-y-2 ${pocket.cashKnown ? 'mt-4 pt-3 border-t border-ink-700' : 'mt-3'}`}>
            {/* Two states, because a subtraction with nothing taken off it is not
                worth three rows. Until a handover has been confirmed, holding IS
                the cash collected and one line says so; after that the working is
                worth showing, because the driver wants to see his handover
                counted and the owner wants to see what is left. */}
            {pocket.hasHandedOver ? (
              <>
                <Row
                  label={t('cash.collectedShort')}
                  hint={t('cash.collectedShortHint')}
                  value={money(pocket.cashIn)}
                />
                <FloatAndExpenses pocket={pocket} driver={driver} name={driverNameIn(summary) || t('cash.driver')} />
                <Row
                  label={t('cash.handedOver')}
                  hint={t('cash.handedOverHint')}
                  value={`− ${money(pocket.handedOver)}`}
                  tone="text-slate-100"
                />
                <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2">
                  <dt className="text-sm font-medium text-slate-200">{t('cash.holdingNow')}</dt>
                  <dd className="num text-warn shrink-0">{money(pocket.holding)}</dd>
                </div>
              </>
            ) : (
              <>
                {(pocket.startingFloat > 0 || pocket.cashExpenses > 0) && (
                  <Row
                    label={t('cash.collectedShort')}
                    hint={t('cash.collectedShortHint')}
                    value={money(pocket.cashIn)}
                  />
                )}
                <FloatAndExpenses pocket={pocket} driver={driver} name={driverNameIn(summary) || t('cash.driver')} />
                <Row
                  label={t('cash.holdingNow')}
                  hint={
                    pocket.startingFloat > 0 || pocket.cashExpenses > 0
                      ? null
                      : t('cash.holdingHint')
                  }
                  value={money(pocket.holding)}
                  tone="text-warn"
                />
              </>
            )}
            <Row
              label={t('cash.byTonight')}
              hint={
                pocket.cashSharePct === null
                  ? t('cash.byTonightNoHistory')
                  : t('cash.byTonightHint', {
                      pct: pocket.cashSharePct,
                      basis: t(basisKey(pocket.cashShareBasis)),
                    })
              }
              value={money(pocket.byTonight)}
            />
            {/* Every rupee of cash goes back, so this is the month's cash in
                full rather than a settlement netted against his pay. The label
                no longer flips: what he is OWED is a separate transaction, and
                subtracting it here quietly understated the money he is carrying
                for somebody else — the one figure this card exists to state. */}
            <Row
              label={t(driver ? 'cash.youHandOver' : 'cash.driverHandsOver')}
              hint={t('cash.handOverHint')}
              value={money(pocket.projectedCash)}
              tone="text-warn"
            />
            {/* Where the month actually settles: the cash he hands back, less
                the pay he is owed. Signed rather than relabelled — a row that
                renamed itself when it went negative made two different states
                look like two different facts, and the driver had to read the
                label to know which way the money was moving. A minus means it
                comes back to him. */}
            <Row
              label={t(driver ? 'cash.afterPay' : 'cash.afterPayOwner')}
              hint={t(pocket.owedToOwner ? 'cash.afterPayHint' : 'cash.afterPayOwedHint')}
              value={`${pocket.owedToOwner ? '' : '\u2212'}${money(pocket.settlement)}`}
              tone={pocket.owedToOwner ? 'text-warn' : 'text-accent'}
            />
            {/* What is still outstanding. Without it the gross figure reads as
                money still owed even after most of it has been handed over. */}
            {pocket.confirmed > 0 && (
              <Row
                label={t('cash.stillToHand')}
                hint={t('cash.stillToHandHint', { amount: money(pocket.confirmed) })}
                value={money(Math.max(0, pocket.leftToHandOver))}
                tone="text-warn"
              />
            )}
            {pocket.pending > 0 && (
              <Row
                label={t('cash.pending')}
                hint={t('cash.pendingHint')}
                value={money(pocket.pending)}
                tone="text-slate-400"
              />
            )}
          </dl>

          {/* The standing instruction, on the card every month rather than only
              when a figure crosses a line. Handing the balance over at month end
              is what keeps the ledger and the cash box agreeing, and a card that
              only says so once something has gone wrong has said it too late. */}
          <p className="text-xs text-slate-400 mt-3">{t('cash.settleAtMonthEnd')}</p>

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

/**
 * The two cash movements that are not fares.
 *
 * A float is the owner's own money, handed over to start the month with — it
 * settles with everything else, so it belongs in the total rather than beside
 * it. An expense he paid out of that cash is money he can no longer hand back,
 * which makes a receipt worth exactly as much as a handover. Both rows are
 * absent when there is nothing to say, so an ordinary month is not made to read
 * like an accounting exercise.
 */
function FloatAndExpenses({ pocket, driver, name }) {
  const { t } = useT();
  return (
    <>
      {pocket.startingFloat > 0 && (
        <Row
          label={t('cash.startingFloat')}
          // Second person on his card, third on the owner's — the same switch
          // every other row in this card makes.
          hint={
            driver
              ? t('cash.startingFloatHint')
              : t('cash.startingFloatHintOwner', { name })
          }
          value={`+ ${money(pocket.startingFloat)}`}
          tone="text-slate-100"
        />
      )}
      {/* One deduction, itemised underneath it.
          The items used to be peers of the subtotal, each carrying its own minus
          — so two expenses produced three minus signs in the column and the
          total read as a third deduction. Only the total takes part in the
          arithmetic above and below it, so only the total sits in that column;
          the items are evidence for it and are indented, smaller and unsigned.
          A single expense needs no subtotal — it IS the total — so it is shown
          as the row itself. */}
      {pocket.cashExpenseLines.length === 1 ? (
        <Row
          label={pocket.cashExpenseLines[0].label || t('cash.cashExpenses')}
          hint={
            pocket.cashExpenseLines[0].date
              ? dayLabel(pocket.cashExpenseLines[0].date)
              : t('cash.cashExpensesRecurring')
          }
          value={`− ${money(pocket.cashExpenses)}`}
          tone="text-slate-100"
        />
      ) : (
        pocket.cashExpenseLines.length > 1 && (
          <div>
            <Row
              label={t('cash.cashExpenses')}
              hint={
                driver
                  ? t('cash.cashExpensesHint', { count: pocket.cashExpenseLines.length })
                  : t('cash.cashExpensesHintOwner', { count: pocket.cashExpenseLines.length })
              }
              value={`− ${money(pocket.cashExpenses)}`}
              tone="text-slate-100"
            />
            <ul className="mt-1 ml-3 pl-2 border-l border-ink-700 space-y-0.5">
              {pocket.cashExpenseLines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-slate-400 min-w-0 truncate">
                    {line.label || t('cash.cashExpenses')}
                    {line.date && <span className="text-slate-500"> · {dayLabel(line.date)}</span>}
                  </span>
                  <span className="num text-xs text-slate-400 shrink-0">{money(line.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </>
  );
}

/** Logging a handover: an amount, a date, and a note if it needs one. */
function HandoverForm({ onCancel, onSaved }) {
  const { t } = useT();
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
      <p className="text-xs text-slate-400 leading-relaxed">{t('cash.form.blurb')}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-slate-400">{t('cash.form.amount')}</span>
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
          <span className="text-[11px] text-slate-400">{t('cash.form.date')}</span>
          <input
            type="date"
            className="w-full"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-[11px] text-slate-400">{t('cash.form.note')}</span>
        <input
          className="w-full"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder={t('cash.form.notePlaceholder')}
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || !Number(form.amount)}>
          {busy ? t('cash.form.saving') : t('cash.form.log')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('cash.form.cancel')}
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
  const { t } = useT();
  const [busy, setBusy] = useState(null);
  if (!pocket.ledger.length) {
    return (
      <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-ink-700">
        {t('cash.ledger.empty')}
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
      <div className="label mb-2">{t('cash.ledger.heading')}</div>
      <dl className="space-y-2">
        {pocket.ledger.map((h) => (
          <div key={h.id} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-slate-300 min-w-0">
              {dayLabel(h.date)}
              <span className="block text-xs text-slate-400">
                {t(h.confirmed ? 'cash.ledger.confirmed' : 'cash.ledger.pending')}
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
                  {t('cash.ledger.confirm')}
                </button>
              )}
              {canWithdraw && !h.confirmed && h.loggedBy === 'driver' && (
                <button
                  className="btn btn-danger text-xs px-2 py-0.5 ml-2"
                  disabled={busy === h.id}
                  onClick={() => act(() => api.deleteHandover(h.id), h.id)}
                >
                  {t('cash.ledger.withdraw')}
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
function basisKey(basis) {
  if (basis === '30d') return 'cash.basis30d';
  if (basis === 'month') return 'cash.basisMonth';
  return 'cash.basisAssumed';
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
