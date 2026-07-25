import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  COST_CATEGORIES,
  COST_FREQUENCIES,
  DEFAULT_COSTS,
  costsForMonth,
  remainingTerm,
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
  if (!rows) return <p className="text-slate-500 text-sm">Loading costs…</p>;

  const preview = costsForMonth(rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })), currentMonth());

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">Running costs</h2>
        <span className="text-xs text-slate-500">
          this month: <span className="num text-slate-300">{amount(preview.total)}</span>
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Cost</th>
              <th className="th">Category</th>
              <th className="th">How often</th>
              <th className="th text-right">Amount</th>
              <th className="th">Starts / on</th>
              <th className="th text-right">Months</th>
              <th className="th text-right">Per month</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <td className="td">
                  <input className="w-full px-2 py-1 text-sm min-w-[7rem]" value={r.label || ''} onChange={(e) => patch(i, 'label', e.target.value)} />
                </td>
                <td className="td">
                  <select className="text-sm py-1 px-1" value={r.category || 'other'} onChange={(e) => patch(i, 'category', e.target.value)} className="text-sm py-1">
                    {COST_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <select value={r.frequency || 'monthly'} onChange={(e) => patch(i, 'frequency', e.target.value)} className="text-sm py-1 px-1">
                    {COST_FREQUENCIES.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <input className="num w-full px-2 py-1 text-sm text-right min-w-[4.5rem]" value={r.amount ?? ''} onChange={(e) => patch(i, 'amount', e.target.value)} />
                </td>
                <td className="td">
                  <input
                    type="date"
                    className="text-sm py-1 px-1"
                    value={r.date || ''}
                    onChange={(e) => patch(i, 'date', e.target.value || null)}
                    title={
                      r.frequency === 'once'
                        ? 'The day this cost was incurred'
                        : 'When this cost started — a term is counted from here'
                    }
                  />
                </td>
                <td className="td text-right">
                  {/* Only recurring costs can have a term. A lease of 60 here,
                      with a start date, stops after the last instalment and is
                      levelled across the holding period in the ROI. */}
                  {r.frequency === 'monthly' ? (
                    <>
                      <input
                        className="num w-full px-2 py-1 text-sm text-right min-w-[3.5rem]"
                        placeholder="—"
                        value={r.termMonths ?? ''}
                        onChange={(e) => patch(i, 'termMonths', e.target.value === '' ? null : e.target.value)}
                      />
                      {r.termMonths && !r.date && (
                        <div className="text-[10px] text-warn mt-0.5">needs a start date</div>
                      )}
                      {r.termMonths && r.date && (
                        <div className="text-[10px] text-slate-600 mt-0.5 num">
                          {remainingTerm({ ...r, termMonths: Number(r.termMonths) }, currentMonth())} left
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-700">—</span>
                  )}
                </td>
                <td className="td num text-right text-slate-400">
                  {amount(preview.items.find((x) => x.id === r.id)?.monthly ?? 0)}
                </td>
                <td className="td text-right">
                  <button className="btn btn-danger text-xs px-2 py-1" onClick={() => setRows(rows.filter((_, n) => n !== i))}>
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        {status && <span className="text-sm text-accent">{status}</span>}
      </div>
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
