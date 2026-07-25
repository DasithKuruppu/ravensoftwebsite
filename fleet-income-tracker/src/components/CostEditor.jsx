import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { COST_CATEGORIES, COST_FREQUENCIES, DEFAULT_COSTS, costsForMonth } from '../../shared/costs.mjs';
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
      const res = await api.saveCosts(rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })));
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
        Yearly costs are spread across twelve months. One-offs count only in the month of their
        date. The driver never sees any of this.
      </p>

      {error && <Banner>{error}</Banner>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead>
            <tr>
              <th className="th">Cost</th>
              <th className="th">Category</th>
              <th className="th">How often</th>
              <th className="th text-right">Amount</th>
              <th className="th">Date</th>
              <th className="th text-right">Per month</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <td className="td">
                  <input className="w-full px-2 py-1 text-sm min-w-[9rem]" value={r.label || ''} onChange={(e) => patch(i, 'label', e.target.value)} />
                </td>
                <td className="td">
                  <select value={r.category || 'other'} onChange={(e) => patch(i, 'category', e.target.value)} className="text-sm py-1">
                    {COST_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <select value={r.frequency || 'monthly'} onChange={(e) => patch(i, 'frequency', e.target.value)} className="text-sm py-1">
                    {COST_FREQUENCIES.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <input className="num w-full px-2 py-1 text-sm text-right min-w-[6rem]" value={r.amount ?? ''} onChange={(e) => patch(i, 'amount', e.target.value)} />
                </td>
                <td className="td">
                  <input type="date" className="text-sm py-1" value={r.date || ''} onChange={(e) => patch(i, 'date', e.target.value || null)} />
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
            setRows([...rows, { id: `cost-${Date.now()}`, label: '', category: 'other', frequency: 'monthly', amount: 0, date: null }])
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
