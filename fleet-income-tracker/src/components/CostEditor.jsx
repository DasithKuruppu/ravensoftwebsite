import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  COST_CATEGORIES,
  COST_FREQUENCIES,
  DEFAULT_COSTS,
  costsForMonth,
  remainingTerm,
  isDriverVisible,
  isDriverPermitted,
} from '../../shared/costs.mjs';
import { amount } from '../format.js';
import { currentMonth, todayLocal } from '../format.js';

/**
 * Running-cost lines. Owner-only, enforced by the API.
 *
 * Frequency is the important field: a yearly insurance premium entered as a
 * monthly cost would overstate every month by twelve times. Annual costs are
 * divided across the year, one-offs land only in their own month.
 */
export default function CostEditor() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.costs().then((r) => setRows(r.costs || [])).catch((e) => setError(e.message));
  }, []);

  const patch = (i, key, value) =>
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  /**
   * Switching to One-off fills the date if it is empty.
   *
   * A one-off is dated BY its date — `monthlyAmount` returns nothing for a
   * one-off with none, so the line is stored, can be ticked, and then quietly
   * belongs to no month at all: invisible in the cost card, in profit and in the
   * driver's cash. The field is easy to miss on a row that began life as a
   * monthly cost, so switching the frequency supplies today rather than leaving
   * a shape that cannot work.
   */
  const setFrequency = (i, frequency) =>
    setRows((prev) =>
      prev.map((r, n) =>
        n === i
          ? { ...r, frequency, date: frequency === 'once' && !r.date ? todayLocal() : r.date }
          : r,
      ),
    );

  async function save() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const res = await api.saveCosts(
        rows.map((r) => ({
          ...r,
          amount: Number(r.amount) || 0,
          termMonths: r.termMonths ? Number(r.termMonths) : null,
          driverVisible: isDriverVisible(r),
          // Only a dated one-off can come out of the driver's cash; the flag is
          // meaningless on a recurring line and would otherwise survive a change
          // of frequency.
          paidByDriverCash: r.paidByDriverCash === true,
        })),
      );
      setRows(res.costs);
      setStatus(`Saved ${res.costs.length} lines.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !rows) return <Banner>{error}</Banner>;
  if (!rows) return <p className="text-slate-400 text-sm">Loading costs…</p>;

  const preview = costsForMonth(rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })), currentMonth());

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">Running costs</h2>
        <span className="text-xs text-slate-400">
          this month: <span className="num text-slate-300">{amount(preview.total)}</span>
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Yearly costs are spread across twelve months; one-offs count only in the month of their
        date. <span className="text-slate-400">Per day driven</span> and{' '}
        <span className="text-slate-400">per km driven</span> scale with what the car actually did,
        so a quiet month costs less — days off are not counted.
        <br />
        For something that ends — a lease — set{' '}
        <span className="text-slate-400">every month</span>, give it a start date, and put the
        number of instalments in <span className="text-slate-400">For (months)</span>: 60 for five
        years. It then stops when the term does, and the return-on-capital view averages it across
        the years you keep the car. The driver never sees any of this.
      </p>

      {error && <Banner>{error}</Banner>}

      {/* One markup, two shapes. A nine-column table needed 40rem to render,
          so on a phone it became a horizontal scroll — the worst possible way to
          edit a form, since half the fields are off-screen while you type. The
          same grid stacks into a card per cost below `lg`, where each field
          carries its own label, and collapses into the familiar table row above
          it, where the header row supplies them instead. */}
      <div className="space-y-3 lg:space-y-0">
        <div className={`hidden lg:grid gap-2 border-b border-ink-700 pb-1 ${COLS}`}>
          {['Cost', 'Category', 'How often', 'Amount', 'Starts / on', 'Months', 'Driver sees', 'Driver paid cash', 'Per month', ''].map(
            (h, n) => (
              <span key={n} className="text-xs text-slate-400 font-medium">
                {h}
              </span>
            ),
          )}
        </div>

        {rows.map((r, i) => (
          <div
            key={r.id || i}
            className={`grid grid-cols-2 gap-3 rounded-lg border border-ink-700 p-3
                        lg:gap-2 lg:items-start lg:rounded-none lg:border-0 lg:border-t lg:p-0 lg:py-2 ${COLS}`}
          >
            <Field label="Cost" className="col-span-2 lg:col-span-1">
              <input
                className="w-full px-2 py-1 text-sm"
                value={r.label || ''}
                onChange={(e) => patch(i, 'label', e.target.value)}
              />
            </Field>

            <Field label="Category">
              <select
                className="w-full text-sm py-1 px-1"
                value={r.category || 'other'}
                onChange={(e) => patch(i, 'category', e.target.value)}
              >
                {COST_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </Field>

            <Field label="How often">
              <select
                className="w-full text-sm py-1 px-1"
                value={r.frequency || 'monthly'}
                onChange={(e) => setFrequency(i, e.target.value)}
              >
                {COST_FREQUENCIES.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Amount">
              <input
                className="num w-full px-2 py-1 text-sm text-right"
                value={r.amount ?? ''}
                onChange={(e) => patch(i, 'amount', e.target.value)}
              />
            </Field>

            <Field label="Starts / on">
              <input
                type="date"
                className="w-full text-sm py-1 px-1"
                value={r.date || ''}
                onChange={(e) => patch(i, 'date', e.target.value || null)}
                title={
                  r.frequency === 'once'
                    ? 'The day this cost was incurred'
                    : 'When this cost started — a term is counted from here'
                }
              />
              {/* Belt and braces. The auto-fill above stops this arising from the
                  frequency picker, but a date can still be cleared by hand, and a
                  dateless one-off counts in no month anywhere in the app. Said in
                  amber on the row rather than left to be discovered as a missing
                  figure three cards away. */}
              {r.frequency === 'once' && !r.date && (
                <div className="text-[11px] text-warn mt-0.5">needs a date, or it counts nowhere</div>
              )}
            </Field>

            {/* Only recurring costs can have a term. A lease of 60 here, with a
                start date, stops after the last instalment and is levelled
                across the holding period in the ROI. */}
            <Field label="Months">
              {r.frequency === 'monthly' ? (
                <>
                  <input
                    className="num w-full px-2 py-1 text-sm text-right"
                    placeholder="—"
                    value={r.termMonths ?? ''}
                    onChange={(e) => patch(i, 'termMonths', e.target.value === '' ? null : e.target.value)}
                  />
                  {r.termMonths && !r.date && (
                    <div className="text-[11px] text-warn mt-0.5">needs a start date</div>
                  )}
                  {r.termMonths && r.date && (
                    <div className="text-[11px] text-slate-400 mt-0.5 num">
                      {remainingTerm({ ...r, termMonths: Number(r.termMonths) }, currentMonth())} left
                    </div>
                  )}
                </>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </Field>

            {/* Charging is his to influence; the lease and depreciation are not.
                Categories outside the driver whitelist cannot be shown to him at
                all — the API filters them out of his responses — so the box is
                disabled rather than offering a promise it will not keep. */}
            <Field label="Driver sees">
              <input
                type="checkbox"
                checked={isDriverVisible(r)}
                disabled={!isDriverPermitted(r)}
                onChange={(e) => patch(i, 'driverVisible', e.target.checked)}
                className="w-4 h-4 accent-slate-400 disabled:opacity-40"
                title={
                  isDriverPermitted(r)
                    ? 'Show this line to the driver'
                    : 'Only charging can be shown to the driver'
                }
              />
            </Field>

            {/* Whose pocket it left. A one-off the driver paid for out of the
                cash he carries is money he can no longer hand over, so it comes
                off his balance the way a handover does — the cash card shows it
                as a subtraction. Only one-offs offer it: nobody hands the driver
                cash to pay the annual insurance. */}
            {/* A plain checkbox on every line, off unless somebody ticks it.
                It works on any frequency: a tick is honoured at whatever the
                cost contributes to the month, so the box can never be ticked and
                silently do nothing. */}
            <Field label="Driver paid cash">
              <input
                type="checkbox"
                checked={r.paidByDriverCash === true}
                onChange={(e) => patch(i, 'paidByDriverCash', e.target.checked)}
                className="w-4 h-4 accent-warn"
                title="Paid by the driver out of the cash he is carrying"
              />
            </Field>

            <Field label="Per month">
              <span className="num text-sm text-slate-200">
                {amount(preview.items.find((x) => x.id === r.id)?.monthly ?? 0)}
              </span>
            </Field>

            <div className="col-span-2 lg:col-span-1 lg:text-right">
              <button
                className="btn btn-danger text-xs px-2 py-1"
                onClick={() => setRows(rows.filter((_, n) => n !== i))}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save costs'}
        </button>
        <button
          className="btn"
          onClick={() =>
            setRows([...rows, { id: `cost-${Date.now()}`, label: '', category: 'other', frequency: 'monthly', amount: 0, date: null, termMonths: null }])
          }
        >
          Add cost
        </button>
        {/* The one-off the driver paid for out of his cash, in one click.
            Building it from "Add cost" meant changing the frequency to One-off
            and setting a date BEFORE the cash box would enable — an ordering
            nothing on the screen tells you about, so the box read as broken. */}
        <button
          className="btn"
          onClick={() =>
            setRows([
              ...rows,
              {
                id: `cost-${Date.now()}`,
                label: '',
                category: 'other',
                frequency: 'once',
                amount: 0,
                date: todayLocal(),
                termMonths: null,
                // Off by default, like every other new line. The button's job is
                // the shape — a one-off, dated today — not the tick.
                paidByDriverCash: false,
              },
            ])
          }
        >
          Add driver expense
        </button>
        <button className="btn" onClick={() => setRows(DEFAULT_COSTS)} disabled={busy}>
          Reset to defaults
        </button>
        {status && <span className="text-sm text-slate-100">{status}</span>}
      </div>
    </div>
  );
}

/** Column geometry, shared by the header row and every cost row. */
const COLS =
  'lg:grid-cols-[minmax(7rem,2fr)_1.2fr_1.2fr_minmax(4.5rem,1fr)_1.1fr_minmax(4rem,.8fr)_.7fr_.7fr_minmax(4.5rem,1fr)_auto]';

/**
 * One field. Its label shows only where the header row is not there to supply
 * it, so nothing is duplicated at desktop width.
 */
function Field({ label, className = '', children }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[11px] text-slate-400 mb-1 lg:hidden">{label}</div>
      {children}
    </div>
  );
}

function Banner({ children }) {
  return (
    <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-3">
      {children}
    </p>
  );
}
