import { describe, it, expect } from 'vitest';
import {
  END_TIME_COLUMN,
  START_TIME_COLUMN,
  feeColumns,
  rowFees,
  datePart,
  guessColumn,
  rememberTripStarts,
  resolveRowDate,
} from './csvMapping.mjs';

const TRIP_ACTIVITY = [
  'Trip UUID', 'Driver first name', 'Number plate', 'Trip request time',
  'Trip drop-off time', 'Trip distance', 'Trip status',
];
const PAYMENTS = ['transaction UUID', 'Trip UUID', 'vs reporting', 'Paid to you : Your earnings'];

const dateField = {
  key: 'date',
  hints: ['trip request time', 'request time', 'pick-up time', 'trip date', 'local date', 'date', 'day', 'reporting'],
  exclude: END_TIME_COLUMN,
};

describe('dating a row by when the trip started', () => {
  it('picks the request time over the drop-off time', () => {
    expect(guessColumn(dateField, TRIP_ACTIVITY, { 'Trip request time': '2026-07-25 09:32:39' }))
      .toBe('Trip request time');
  });

  it('refuses a drop-off column even when it is the only date left', () => {
    // A trip requested at 23:40 and dropped off at 00:20 would otherwise have
    // its whole fare filed under the following day.
    const cols = ['Trip UUID', 'Trip drop-off time', 'Fare'];
    expect(guessColumn(dateField, cols, { 'Trip drop-off time': '2026-07-26 00:20:00' })).toBe('');
  });

  it.each(['Trip drop-off time', 'Dropoff time', 'Completed at', 'Trip end time', 'Arrival time'])(
    'treats %s as an end-of-trip column',
    (col) => expect(END_TIME_COLUMN.test(col)).toBe(true),
  );

  it.each(['Trip request time', 'Pick-up time', 'Trip date', 'vs reporting'])(
    'leaves %s available as a start column',
    (col) => expect(END_TIME_COLUMN.test(col)).toBe(false),
  );
});

describe('datePart', () => {
  it('reads the trip activity format', () => {
    expect(datePart('2026-07-25 09:32:39')).toBe('2026-07-25');
  });

  it('reads the payments format without shifting the offset', () => {
    // Already Colombo local time; Date parsing would move it by the viewer's
    // timezone and could land on the previous day.
    expect(datePart('2026-07-20 12:11:07.293 +0530 +0530')).toBe('2026-07-20');
  });

  it('reads day-first dates', () => {
    expect(datePart('05/07/2026')).toBe('2026-07-05');
  });

  it('returns nothing for a non-date', () => {
    expect(datePart('Trip UUID')).toBe('');
    expect(datePart('')).toBe('');
    expect(datePart(undefined)).toBe('');
  });
});

describe('remembering trip start times', () => {
  const rows = [
    { 'Trip UUID': 'a', 'Trip request time': '2026-07-25 23:40:00' },
    { 'Trip UUID': 'b', 'Trip request time': '2026-07-26 07:10:00' },
  ];
  const learned = rememberTripStarts({}, rows, {
    tripIdColumn: 'Trip UUID',
    dateColumn: 'Trip request time',
  });

  it('learns a start date per trip', () => {
    expect(learned).toEqual({ a: '2026-07-25', b: '2026-07-26' });
  });

  it('does not learn anything without both columns', () => {
    expect(rememberTripStarts({}, rows, { tripIdColumn: 'Trip UUID', dateColumn: '' })).toEqual({});
  });

  it('dates a payment by the trip it paid for, not by when it settled', () => {
    // The overnight case: the trip began at 23:40 on the 25th, Uber posted the
    // payment at 00:31 on the 26th. The fare belongs to the 25th.
    const payment = { 'Trip UUID': 'a', 'vs reporting': '2026-07-26 00:31:02.114 +0530 +0530' };
    expect(
      resolveRowDate(payment, {
        mapping: { tripId: 'Trip UUID', date: 'vs reporting' },
        tripStarts: learned,
      }),
    ).toEqual({ date: '2026-07-25', basis: 'tripStart' });
  });

  it('falls back to the row timestamp for an unknown trip, and says so', () => {
    const payment = { 'Trip UUID': 'zzz', 'vs reporting': '2026-07-26 00:31:02.114 +0530 +0530' };
    expect(
      resolveRowDate(payment, {
        mapping: { tripId: 'Trip UUID', date: 'vs reporting' },
        tripStarts: learned,
      }),
    ).toEqual({ date: '2026-07-26', basis: 'timestampUnmatched' });
  });

  it('uses the chosen date for a file with no trip ids at all', () => {
    expect(
      resolveRowDate(
        { Date: '2026-07-25' },
        { mapping: { date: 'Date' }, tripStarts: learned },
      ),
    ).toEqual({ date: '2026-07-25', basis: 'timestamp' });
  });

  it('uses the fallback date when the file has no date column', () => {
    expect(
      resolveRowDate({ Fare: '1200' }, { mapping: {}, tripStarts: {}, fallbackDate: '2026-07-25' }),
    ).toEqual({ date: '2026-07-25', basis: 'fallback' });
  });
});

describe('what may teach the lookup', () => {
  it.each(['Trip request time', 'Pick-up time', 'Trip date', 'Start time'])(
    'accepts %s as a start-time column',
    (col) => expect(START_TIME_COLUMN.test(col)).toBe(true),
  );

  it.each(['vs reporting', 'Trip drop-off time', 'Transaction time'])(
    'refuses %s as a start-time column',
    (col) => expect(START_TIME_COLUMN.test(col)).toBe(false),
  );

  it('refuses to learn start times from a settlement timestamp', () => {
    // "vs reporting" is when Uber posted the money. Learning it as a start time
    // would file an overnight fare under the settlement day — the exact error
    // the lookup exists to prevent.
    const rows = [{ 'Trip UUID': 'a', 'vs reporting': '2026-07-26 00:31:02.114 +0530 +0530' }];
    expect(
      rememberTripStarts({}, rows, { tripIdColumn: 'Trip UUID', dateColumn: 'vs reporting' }),
    ).toEqual({});
  });

  it('keeps a start time already learned from the trip activity export', () => {
    const known = { a: '2026-07-25' };
    const rows = [{ 'Trip UUID': 'a', 'vs reporting': '2026-07-26 00:31:02.114 +0530 +0530' }];
    expect(
      rememberTripStarts(known, rows, { tripIdColumn: 'Trip UUID', dateColumn: 'vs reporting' }),
    ).toEqual(known);
  });
});

describe("Uber's own charges and refunds", () => {
  // The real header set from the payments export.
  const PAYMENT_COLS = [
    'Trip UUID',
    'vs reporting',
    'Paid to you',
    'Paid to you : Your earnings',
    'Paid to you : Trip balance : Payouts : Cash collected',
    'Paid to you:Trip balance:Refunds:Toll',
    'Paid to you:Trip balance:Expenses:Driver subscription charge',
    'Paid to you:Trip balance:Expenses:Flex Pay fee',
    'Paid to you:Trip balance:Payouts:Transferred To Bank Account',
    'Paid to you:Your earnings:Fare:Fare',
  ];

  it('finds every expense and refund column', () => {
    expect(feeColumns(PAYMENT_COLS)).toEqual([
      'Paid to you:Trip balance:Refunds:Toll',
      'Paid to you:Trip balance:Expenses:Driver subscription charge',
      'Paid to you:Trip balance:Expenses:Flex Pay fee',
    ]);
  });

  it('leaves payouts alone', () => {
    // Cash taken by the driver and money wired to the bank are the same fare
    // moving, not a new cost — counting them would double-charge the fare.
    const found = feeColumns(PAYMENT_COLS);
    expect(found.some((c) => /payouts/i.test(c))).toBe(false);
  });

  it('leaves earnings alone', () => {
    expect(feeColumns(PAYMENT_COLS).some((c) => /your earnings/i.test(c))).toBe(false);
  });

  it('nets a row, keeping the export signs', () => {
    const row = {
      'Paid to you:Trip balance:Refunds:Toll': '200',
      'Paid to you:Trip balance:Expenses:Driver subscription charge': '-1204',
      'Paid to you:Trip balance:Expenses:Flex Pay fee': '-5.92',
    };
    expect(rowFees(row, feeColumns(PAYMENT_COLS))).toBeCloseTo(-1009.92, 2);
  });

  it('reports nothing for a row with no fee figures at all', () => {
    expect(rowFees({ 'Paid to you : Your earnings': '1200' }, feeColumns(PAYMENT_COLS)))
      .toBeUndefined();
  });

  it('reports zero, not nothing, when the fees genuinely cancel', () => {
    // A Drive Pass tax charged and refunded in the same row nets to zero, and
    // that is a fact about the day rather than an absence of data.
    const row = {
      'Paid to you:Trip balance:Refunds:Toll': '550.98',
      'Paid to you:Trip balance:Expenses:Driver subscription charge': '-550.98',
    };
    expect(rowFees(row, feeColumns(PAYMENT_COLS))).toBe(0);
  });
});
