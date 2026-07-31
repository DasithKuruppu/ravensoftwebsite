/**
 * The charging network's session export.
 *
 * The trap this guards is arithmetic, not parsing: the export is a wallet
 * statement where top-ups outnumber charges and dwarf them in value, so a naive
 * reader reports fourteen times the real spend.
 *
 * The fixture is inline rather than a file under `data/`. That directory is
 * gitignored — the real exports carry the driver's name, email and phone, and
 * this repo is public — so a test reading one would pass here and fail for
 * everybody else. This is the same shape and the same arithmetic as the July
 * file, with nothing personal in it.
 */
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { parseChargeRows, mergeSessions, localDateOf, mapChargeColumns } from './chargeCsv.mjs';

const EXPORT = `timestamp,type,charger_id,charger_name,kwh,subtotal_lkr_excl_vat,vat_lkr_18pct,gross_lkr,balance_after_lkr,transaction_ref,reason
2026-07-11T14:29:18Z,TOPUP,,,,,,5000.00,5000.00,121730,
2026-07-11T14:47:30Z,COMMERCIAL_CHARGE,100153,Keells - Nalluruwa,5.90,750.00,135.00,885.00,4115.00,232839,"Charge session 232839"
2026-07-11T14:59:35Z,COMMERCIAL_CHARGE,100153,Keells - Nalluruwa,3.51,446.19,80.31,526.50,3588.50,232849,"Charge session 232849"
2026-07-12T16:11:27Z,COMMERCIAL_CHARGE,100153,Keells - Nalluruwa,5.91,751.27,135.23,886.50,2702.00,233597,"Charge session 233597"
2026-07-20T08:28:48Z,TRANSFER_OUT,,,,,,2500.00,202.00,TRF-1,Transfer out
2026-07-21T13:12:27Z,TOPUP,,,,,,2500.00,2702.00,121731,
2026-07-21T13:14:31Z,TRANSFER_OUT,,,,,,2000.00,702.00,TRF-2,Transfer out
2026-07-22T10:56:07Z,TOPUP,,,,,,5000.00,5702.00,121732,
2026-07-22T10:57:47Z,TRANSFER_OUT,,,,,,4000.00,1702.00,TRF-3,Transfer out
2026-07-23T19:16:30Z,TOPUP,,,,,,5000.00,6702.00,121733,
2026-07-23T19:18:58Z,TRANSFER_OUT,,,,,,4000.00,2702.00,TRF-4,Transfer out
2026-07-24T17:02:32Z,TRANSFER_OUT,,,,,,2700.00,2.00,TRF-5,Transfer out
2026-07-25T14:55:17Z,TOPUP,,,,,,10000.00,10002.00,121734,
2026-07-25T14:58:11Z,TRANSFER_OUT,,,,,,8000.00,2002.00,TRF-6,Transfer out
2026-07-31T13:46:15Z,TOPUP,,,,,,5000.00,7002.00,121735,
2026-07-31T13:46:38Z,TRANSFER_OUT,,,,,,5000.00,2002.00,TRF-7,Transfer out
# Period: 2026-07-01 to 2026-07-31
# Rows: 16
# Total kWh: 15.32
# Sessions subtotal (pre-VAT, LKR): 1947.46
# Sessions VAT (18%, LKR): 350.54
# Total charged gross (LKR): 2298.00
# Total topped up (LKR): 32500.00
# Filter: type=both`;

const parseFile = () =>
  parseChargeRows(Papa.parse(EXPORT, { header: true, skipEmptyLines: true }).data);

describe('a VoltCharge session export', () => {
  it('takes the three charge sessions and none of the wallet movements', () => {
    const out = parseFile();
    expect(out.sessions).toBe(3);
    // The export's own footer says so: "Total charged gross (LKR): 2298.00".
    expect(out.total).toBe(2298);
    // 32,500 was topped up and never spent on electricity. Counting it would put
    // the month's charging cost at fifteen times what the car actually used.
    expect(out.skipped.notACharge).toBeGreaterThan(0);
  });

  it('groups them onto the days they happened, in Colombo time', () => {
    const out = parseFile();
    expect(out.days.map((d) => d.date)).toEqual(['2026-07-11', '2026-07-12']);
    expect(out.days[0].sessions).toHaveLength(2);
    expect(out.days[0].sessions.reduce((s, x) => s + x.amount, 0)).toBe(1411.5);
    expect(out.days[1].sessions[0].amount).toBe(886.5);
  });

  it('carries the station and the kWh across', () => {
    const [first] = parseFile().days[0].sessions;
    expect(first.station).toBe('Keells - Nalluruwa');
    expect(first.kwh).toBe(5.9);
    // The network's own reference, so a second import replaces rather than adds.
    expect(first.id).toBe('csv-232839');
  });

  it('ignores the summary block the export appends', () => {
    // "# Total kWh: 15.32" and friends are not rows; nothing may be read off them.
    const out = parseFile();
    expect(out.sessions).toBe(3);
    expect(out.days.every((d) => d.date.startsWith('2026-07'))).toBe(true);
  });
});

describe('the day a session belongs to', () => {
  /**
   * Colombo is UTC+5:30, so the last six and a half hours of any UTC day are
   * already tomorrow here. Read as UTC these land on the wrong day — and on the
   * 31st, in the wrong month's costs.
   */
  it('rolls a late-evening UTC session into the next local day', () => {
    expect(localDateOf('2026-07-31T19:00:00Z')).toBe('2026-08-01');
    expect(localDateOf('2026-07-31T18:29:00Z')).toBe('2026-07-31');
  });

  it('is unmoved by a timestamp already inside the local day', () => {
    expect(localDateOf('2026-07-11T14:47:30Z')).toBe('2026-07-11');
  });

  it('returns nothing for a timestamp it cannot read', () => {
    expect(localDateOf('not a date')).toBe(null);
  });
});

describe('column matching', () => {
  it('finds the columns whatever case or punctuation the export uses', () => {
    const cols = mapChargeColumns(['Timestamp', 'Type', 'Charger Name', 'kWh', 'Gross LKR', 'Transaction Ref']);
    expect(cols.timestamp).toBe('Timestamp');
    expect(cols.station).toBe('Charger Name');
    expect(cols.amount).toBe('Gross LKR');
    expect(cols.ref).toBe('Transaction Ref');
  });

  /**
   * Gross, not subtotal: the subtotal excludes VAT and the driver paid the VAT.
   * Taking the pre-VAT figure would understate every session by 18%.
   */
  it('prefers the gross amount over the pre-VAT subtotal', () => {
    const [{ sessions }] = parseChargeRows([
      {
        timestamp: '2026-07-11T14:47:30Z',
        type: 'COMMERCIAL_CHARGE',
        subtotal_lkr_excl_vat: '750.00',
        gross_lkr: '885.00',
      },
    ]).days;
    expect(sessions[0].amount).toBe(885);
  });
});

describe('merging into a day that already has sessions', () => {
  it('keeps what the driver logged by hand', () => {
    const existing = [{ id: 'chg-manual-1', amount: 2400, station: 'home', kwh: 30 }];
    const merged = mergeSessions(existing, [{ id: 'csv-232839', amount: 885, station: 'Keells', kwh: 5.9 }]);
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.id)).toContain('chg-manual-1');
  });

  it('replaces its own earlier import rather than doubling the day', () => {
    const first = mergeSessions([], [{ id: 'csv-232839', amount: 885 }]);
    const again = mergeSessions(first, [{ id: 'csv-232839', amount: 885 }]);
    expect(again).toHaveLength(1);
    expect(again.reduce((s, x) => s + x.amount, 0)).toBe(885);
  });

  it('updates a session the network later corrected', () => {
    const merged = mergeSessions([{ id: 'csv-232839', amount: 885 }], [{ id: 'csv-232839', amount: 910 }]);
    expect(merged).toEqual([{ id: 'csv-232839', amount: 910 }]);
  });
});
