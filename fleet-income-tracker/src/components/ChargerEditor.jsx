import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DEFAULT_CHARGERS } from '../../shared/chargers.mjs';

/**
 * Editable charging-station list.
 *
 * The list is stored server-side, so corrections and new stations take effect
 * immediately without a redeploy. The seed list in shared/chargers.mjs is only
 * the starting point and what "Reset to seed list" restores.
 *
 * Rates are LKR/kWh. A station either has a flat rate or time-of-use bands;
 * leaving both blank simply means the rate is unknown and the dashboard says so
 * rather than guessing.
 */
export default function ChargerEditor() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .chargers()
      .then((r) => setRows(r.chargers || []))
      .catch((e) => setError(e.message));
  }, []);

  function patch(i, key, value) {
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  }
  function patchTou(i, band, value) {
    setRows((prev) =>
      prev.map((r, n) => (n === i ? { ...r, tou: { ...(r.tou || {}), [band]: value } } : r)),
    );
  }

  async function save() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const cleaned = rows.map((r) => ({
        ...r,
        lat: Number(r.lat),
        lng: Number(r.lng),
        flatRate: r.flatRate === '' || r.flatRate === null ? null : Number(r.flatRate),
        tou: r.tou
          ? {
              day: numOrNull(r.tou.day),
              peak: numOrNull(r.tou.peak),
              offPeak: numOrNull(r.tou.offPeak),
            }
          : null,
      }));
      const res = await api.saveChargers(cleaned);
      setRows(res.chargers);
      setStatus(`Saved ${res.chargers.length} stations.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !rows) return <Banner>{error}</Banner>;
  if (!rows) return <p className="text-slate-500 text-sm">Loading chargers…</p>;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">Charging stations</h2>
        <span className="text-xs text-slate-500">
          <span className="num">{rows.length}</span> stations · shown nearest-first on the dashboard
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Rates in LKR per kWh. Use the flat rate for operators with one price, or the three
        time-of-use bands (day / peak / off-peak). Leave blank if unknown.
      </p>

      {error && <Banner>{error}</Banner>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[52rem]">
          <thead>
            <tr>
              <th className="th">Name</th>
              <th className="th">Network / app</th>
              <th className="th text-right">Lat</th>
              <th className="th text-right">Lng</th>
              <th className="th text-right">Flat</th>
              <th className="th text-right">Day</th>
              <th className="th text-right">Peak</th>
              <th className="th text-right">Off-pk</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <td className="td">
                  <Cell value={r.name} onChange={(v) => patch(i, 'name', v)} wide />
                  <Cell
                    value={r.address || ''}
                    onChange={(v) => patch(i, 'address', v)}
                    wide
                    muted
                    placeholder="address"
                  />
                </td>
                <td className="td">
                  <Cell value={r.network || ''} onChange={(v) => patch(i, 'network', v)} />
                  <Cell value={r.app || ''} onChange={(v) => patch(i, 'app', v)} muted placeholder="app" />
                </td>
                <td className="td"><Num value={r.lat} onChange={(v) => patch(i, 'lat', v)} /></td>
                <td className="td"><Num value={r.lng} onChange={(v) => patch(i, 'lng', v)} /></td>
                <td className="td"><Num value={r.flatRate ?? ''} onChange={(v) => patch(i, 'flatRate', v)} /></td>
                <td className="td"><Num value={r.tou?.day ?? ''} onChange={(v) => patchTou(i, 'day', v)} /></td>
                <td className="td"><Num value={r.tou?.peak ?? ''} onChange={(v) => patchTou(i, 'peak', v)} /></td>
                <td className="td"><Num value={r.tou?.offPeak ?? ''} onChange={(v) => patchTou(i, 'offPeak', v)} /></td>
                <td className="td text-right">
                  <button
                    className="btn btn-danger text-xs px-2 py-1"
                    onClick={() => setRows(rows.filter((_, n) => n !== i))}
                  >
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
          {busy ? 'Saving…' : 'Save stations'}
        </button>
        <button
          className="btn"
          onClick={() =>
            setRows([
              ...rows,
              { id: `charger-${Date.now()}`, name: '', address: '', network: '', app: '', lat: '', lng: '', connectors: ['CCS2'], verified: 'osm' },
            ])
          }
        >
          Add station
        </button>
        <button className="btn" onClick={() => setRows(DEFAULT_CHARGERS)} disabled={busy}>
          Reset to seed list
        </button>
        {status && <span className="text-sm text-accent">{status}</span>}
      </div>
    </div>
  );
}

function Cell({ value, onChange, wide, muted, placeholder }) {
  return (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-2 py-1 text-sm ${wide ? 'min-w-[11rem]' : 'min-w-[7rem]'} ${
        muted ? 'text-slate-500 text-xs' : ''
      }`}
    />
  );
}

function Num({ value, onChange }) {
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      className="num w-full px-2 py-1 text-sm text-right min-w-[5rem]"
    />
  );
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function Banner({ children }) {
  return (
    <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-3">
      {children}
    </p>
  );
}
