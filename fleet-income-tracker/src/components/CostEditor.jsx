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
import { currentMonth } from '../format.js';

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
          {['Cost', 'Category', 'How often', 'Amount', 'Starts / on', 'Months', 'Driver sees', 'Per month', ''].map(
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
                onChange={(e) => patch(i, 'frequency', e.target.value)}
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
  'lg:grid-cols-[minmax(7rem,2fr)_1.2fr_1.2fr_minmax(4.5rem,1fr)_1.1fr_minmax(4rem,.8fr)_.7fr_minmax(4.5rem,1fr)_auto]';

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
