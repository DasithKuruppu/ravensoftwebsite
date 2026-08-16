/**
 * What a long hire costs.
 *
 * A hire is not a taxi fare. The customer is buying a driver's day, not a
 * distance, so the base unit here is a **day** — eight hours of it for a
 * single-day hire, the whole calendar day once a trip stays out overnight, and
 * `chargeTime` explains why those are not the same thing. Eight hours is also
 * the shortest hire this service takes. Distance is charged only past a daily
 * allowance, because a full day spent inside Colombo and a full day driving to
 * Jaffna cost the fleet very different amounts in energy and wear, but both cost
 * the same driver's day.
 *
 * Two ways to buy it, and they meet at the same `quote()`:
 *
 *   routed   the customer describes a journey, it is routed, and the measured
 *            distance is priced
 *   daily    the customer takes the car for N days with a kilometre allowance
 *            and no itinerary at all — see `dailyBasis`
 *
 * Four things move the price, and each is a separate line on the quote so a
 * customer can see which one they can change:
 *
 *   days        the driver's time: hours inside a single day, whole days across
 *               several — see `chargeTime` for why those are not the same unit
 *   distance    kilometres beyond `includedKmPerDay × days`
 *   nights      each local midnight the trip spans, for the driver's stay
 *   class       a multiplier on time+distance for a larger vehicle
 *
 * Every rate lives in the rate card, which is stored in DynamoDB and edited from
 * the admin page. Nothing here is a literal that would need a deploy to change.
 *
 * All amounts are LKR. All durations are hours, all distances kilometres.
 */

/** The rate card as shipped. The admin page overwrites any subset of it. */
export const DEFAULT_RATES = {
  /**
   * Hours in one charged "day" — a full day's driving, and also the shortest
   * hire accepted. Ten, not eight: a hire day on this island runs dawn to
   * evening, and eight hours pushed trips into a second day that a driver
   * completes comfortably in one.
   */
  hoursPerDay: 10,
  /** The driver-and-vehicle day, covering `includedKmPerDay`. Also the floor:
   *  no hire is priced below one of these. */
  dayRate: 20000,
  /** Kilometres included in each charged day. */
  includedKmPerDay: 150,
  /** Every kilometre past the allowance. */
  perKmOver: 90,
  /**
   * Hours past a whole number of days. Never charged past the point where a
   * whole extra day would be cheaper — see `chargeTime`.
   */
  overtimePerHour: 2200,
  /**
   * The driver's overnight stay, charged for **each night** he is away from
   * home — his bed, his meals, and the fact of not being at home to take other
   * work. A hire that is back the same evening never sees it.
   *
   * This is the single per-night driver charge. An earlier `nightAllowance` of
   * 2,500 covered the same ground and was folded into this rather than left to
   * bill alongside it, which would have charged the same night twice under two
   * names.
   */
  overnightStay: 5000,
  /**
   * The same night when the customer puts the driver up themselves.
   *
   * On a hotel tour there is usually a staff room going spare, so a customer who
   * feeds and houses the driver has covered the whole of what this line pays
   * for. The charge therefore comes off entirely — the fleet is not billing for
   * a bed it never booked — and the quote drops the line rather than showing a
   * nought.
   *
   * Kept as a rate rather than a hard zero so the saving can be dialled back
   * later without a deploy, if it turns out the night is worth something to the
   * fleet even when somebody else buys dinner.
   */
  overnightStayHosted: 0,
  /**
   * Charged per intermediate stop. Zero by default: the detour a stop causes is
   * already in the routed distance, and a short wait is already in the hours.
   * Exists so a fleet that finds stops genuinely costly can price them.
   */
  stopFee: 0,
  /**
   * The fleet, and what each vehicle multiplies time + distance by (never the
   * night allowance or a stop fee — the driver eats the same dinner whichever
   * car he parked outside).
   *
   * One entry, because the fleet is one hatchback EV. Offering an SUV the fleet
   * cannot supply would take a booking that has to be declined, which costs
   * more goodwill than the booking was worth. Add a row from Admin → Rates when
   * a second vehicle arrives; the multiplier machinery is unchanged and the
   * form grows a picker on its own once there is more than one.
   */
  vehicleClasses: [
    {
      key: 'baw-e7-pro',
      label: 'BAW E7 Pro · Electric hatchback, up to 3 passengers',
      seats: 3,
      multiplier: 1,
    },
  ],
  /** Quotes are rounded up to this, so nobody is asked for LKR 43,617. */
  roundTo: 100,
  /** How long a quote is honoured, in minutes. */
  quoteValidMinutes: 60,
  /** Padding added to routed driving time before it is compared with the ask. */
  bufferHoursPerDay: 1,
  currency: 'LKR',
};

/**
 * The lengths of hire on offer. A customer thinks in days, not hours.
 *
 * Free text invited answers the fleet does not sell — 5 hours, 37 hours — and
 * every one of them had to be argued down by a validation message. A short list
 * of real answers removes the argument.
 */
export const DURATION_CHOICES = [
  { days: 1, label: 'A day' },
  { days: 2, label: '2 days' },
  { days: 3, label: '3 days' },
  { days: 4, label: '4 days' },
  { days: 7, label: 'A week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: 'A month' },
];

/**
 * Hours in a hire of `days` days.
 *
 * Not `days × 24`. A one-day hire is a working day — the car goes out in the
 * morning and is back that evening — so it is `hoursPerDay`, not a full
 * revolution of the clock. Every day after the first *is* a whole day, because
 * the car stays out overnight.
 *
 * So: 1 day → 10 hours, 2 days → 34, a week → 154. Which is what makes the
 * arithmetic come out right at both ends — `chargeTime` bills exactly `days`
 * days, and `nightsAway` counts exactly `days - 1` nights, for every entry in
 * `DURATION_CHOICES`. Using 24 hours a day instead would bill a one-day hire as
 * two and put a night's allowance on a trip that never stopped anywhere.
 */
export function hoursForDays(days, rates) {
  const r = withDefaults(rates);
  const n = Math.max(1, Math.round(Number(days) || 1));
  return (n - 1) * 24 + r.hoursPerDay;
}

/**
 * The shortest hire this itinerary honestly fits into.
 *
 * A day of hire is a driver's working day. Colombo to Ella and back is over ten
 * hours at the wheel — that is not a long day, it is two days, and selling it as
 * one means a driver leaving at dawn and arriving after dark on the same shift.
 * The quote already stretches the hours and charges overtime when the route
 * overruns, so the price stays honest either way; what this adds is *saying so*,
 * before the customer books a day that cannot comfortably hold their trip.
 *
 * Snapped up to a length actually on offer, so the suggestion is always one the
 * customer can act on in a single tap.
 */
export function suggestedChoice(onRoadHours, rates) {
  const r = withDefaults(rates);
  const hours = Math.max(0, Number(onRoadHours) || 0);
  const days = hours <= r.hoursPerDay ? 1 : Math.ceil(hours / r.hoursPerDay);
  return (
    DURATION_CHOICES.find((c) => c.days >= days) || DURATION_CHOICES[DURATION_CHOICES.length - 1]
  );
}

/** The inverse, for showing a stored booking back as the choice that made it. */
export function daysForHours(hours, rates) {
  const r = withDefaults(rates);
  const h = Number(hours) || 0;
  if (h <= r.hoursPerDay) return 1;
  return Math.max(1, Math.round((h - r.hoursPerDay) / 24) + 1);
}

/** The rate card with anything the admin has not set filled in from defaults. */
export function withDefaults(rates) {
  const merged = { ...DEFAULT_RATES, ...(rates || {}) };
  // A half-saved rate card must not silently drop the vehicle list, or every
  // quote after it would fail to find its class and price the fleet's smallest
  // car for a trip somebody booked a van for.
  if (!Array.isArray(merged.vehicleClasses) || merged.vehicleClasses.length === 0) {
    merged.vehicleClasses = DEFAULT_RATES.vehicleClasses;
  }
  return merged;
}

export function vehicleClass(rates, key) {
  const r = withDefaults(rates);
  return r.vehicleClasses.find((v) => v.key === key) || r.vehicleClasses[0];
}

/**
 * Days and overtime for a hire of `hours`.
 *
 * Two regimes, because a day of hire means two different things:
 *
 *   Inside one day  the customer is buying hours. Eight are included; more are
 *                   charged hourly.
 *   Across days     the customer is buying days. A driver on a touring day is
 *                   on duty for part of it and asleep in the vehicle's hotel for
 *                   the rest, and no quote written in advance can say which
 *                   hours were which. Charging a 24-hour hire as three
 *                   eight-hour days would treat the driver's night as billable
 *                   work and put the price at three times the market.
 *
 * The rule inside the first day: leftover hours are charged hourly only while
 * that is cheaper than another whole day. A 12-hour hire is a day plus four
 * hours; a 15-hour hire is simply two days, because seven hours of overtime
 * would cost more than the day it nearly is. Without the cap the price curve
 * spikes just before each boundary, and a customer who noticed could extend the
 * trip to pay less — a pricing bug, not a bargain.
 */
export function chargeTime(hours, rates) {
  const r = withDefaults(rates);
  const billable = Math.max(hours, r.hoursPerDay);
  const calendarDays = Math.max(1, Math.ceil(billable / 24));

  if (calendarDays > 1) {
    return { days: calendarDays, overtimeHours: 0, roundedUpToDay: false };
  }

  const leftover = round2(billable - r.hoursPerDay);
  if (leftover <= 0) return { days: 1, overtimeHours: 0, roundedUpToDay: false };
  if (leftover * r.overtimePerHour >= r.dayRate) {
    return { days: 2, overtimeHours: 0, roundedUpToDay: true };
  }
  return { days: 1, overtimeHours: leftover, roundedUpToDay: false };
}

/**
 * Local midnights crossed between `startAt` and `startAt + hours`.
 *
 * Counted in the fleet's timezone rather than the browser's: a customer booking
 * from London must not be quoted one night for a trip the driver spends two
 * nights on. `tzOffsetMinutes` defaults to Asia/Colombo, which has no DST, so a
 * fixed offset is exact rather than an approximation.
 */
export function nightsAway(startAt, hours, tzOffsetMinutes = 330) {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return 0;
  const end = new Date(start.getTime() + hours * 3600_000);
  const localDay = (d) => Math.floor((d.getTime() + tzOffsetMinutes * 60_000) / 86_400_000);
  return Math.max(0, localDay(end) - localDay(start));
}

/**
 * The hours actually being bought.
 *
 * A customer asks for a duration; the route says how long the driving alone
 * takes. The hire is the larger of the two, because a driver cannot complete an
 * eleven-hour drive inside an eight-hour hire, and quoting eight would be a
 * price we could not honour. The buffer covers meals, traffic and the fact that
 * routed time is a best case.
 *
 * Returns the hours plus which input decided them, so the quote can say so
 * rather than appearing to have invented a number.
 */
export function hireHours({ requestedHours, drivingHours = 0, dwellHours = 0 }, rates) {
  const r = withDefaults(rates);
  const asked = Math.max(Number(requestedHours) || 0, r.hoursPerDay);
  const days = Math.max(1, Math.ceil(asked / 24));
  const needed = drivingHours + dwellHours + r.bufferHoursPerDay * days;
  const hours = Math.max(asked, needed);
  return {
    hours: round2(hours),
    drivenBy: hours > asked + 1e-9 ? 'route' : 'request',
    requestedHours: round2(asked),
    minimumHours: round2(needed),
  };
}

/**
 * The inputs for a hire bought by the day rather than by the journey.
 *
 * Some customers do not have an itinerary. They want the car and a driver for
 * four days and will decide where to go over breakfast — and asking them to
 * invent a route so the form can price one produces a number that is wrong the
 * moment they change their minds.
 *
 * So this takes days and a kilometre allowance and nothing else. It is the same
 * rate card and the same `quote()` underneath, which matters: the two ways of
 * buying cannot drift apart into different prices for the same days and
 * kilometres. `allowanceKm` defaults to the days' own included distance, so the
 * plainest possible hire — four days, standard allowance — needs one number
 * from the customer.
 */
export function dailyBasis({ days, allowanceKm, startAt, vehicleClass, driverHosted }, rates) {
  const r = withDefaults(rates);
  const n = Math.max(1, Math.round(Number(days) || 1));
  const included = n * r.includedKmPerDay;
  const km = Math.max(included, Math.round(Number(allowanceKm) || 0) || included);
  return {
    distanceKm: km,
    driverHosted: Boolean(driverHosted),
    // Marks this as a hire bought by the day. The driver's fee applies to every
    // one of them, however short — the car and his day are committed either way.
    daily: true,
    // No route, so no driving time to reason about: the hire is exactly the
    // days asked for. `chargeTime` turns that into the same day count a routed
    // trip of the same length would bill.
    drivingHours: 0,
    dwellHours: 0,
    requestedHours: hoursForDays(n, r),
    startAt,
    stops: 0,
    vehicleClass,
  };
}

/**
 * The quote. Pure: same inputs, same price, no clock and no network.
 *
 * `trip` carries what the customer chose and what the router measured:
 *   { distanceKm, drivingHours, dwellHours, requestedHours, startAt,
 *     stops, vehicleClass }
 */
export function quote(trip, rates) {
  const r = withDefaults(rates);
  const vc = vehicleClass(r, trip.vehicleClass);

  const time = hireHours(
    {
      requestedHours: trip.requestedHours,
      drivingHours: trip.drivingHours || 0,
      dwellHours: trip.dwellHours || 0,
    },
    r,
  );
  const { days, overtimeHours, roundedUpToDay } = chargeTime(time.hours, r);

  const distanceKm = Math.max(0, Number(trip.distanceKm) || 0);
  const includedKm = days * r.includedKmPerDay;
  const excessKm = Math.max(0, round2(distanceKm - includedKm));
  const nights = nightsAway(trip.startAt, time.hours, r.tzOffsetMinutes);
  const stops = Math.max(0, Number(trip.stops) || 0);

  // Time and distance scale with the vehicle; a night's board and a stop fee do
  // not — the driver eats the same dinner whichever car he parked outside.
  const dayCharge = days * r.dayRate;
  const overtimeCharge = overtimeHours * r.overtimePerHour;
  const distanceCharge = excessKm * r.perKmOver;
  const scaled = (dayCharge + overtimeCharge + distanceCharge) * vc.multiplier;

  const stopCharge = stops * r.stopFee;

  // One per night away, whether the customer described a route or simply took
  // the car for several days. A cost of the driver rather than of the vehicle,
  // so no class multiplier touches it.
  //
  // The reduced rate applies when the customer is housing and feeding him. It is
  // clamped below the full rate so a mis-edited card can never make hosting the
  // driver the more expensive choice — which would be a baffling thing for a
  // customer to discover after ticking a box offering to help.
  const hosted = Boolean(trip.driverHosted);
  const perNight = hosted ? Math.min(r.overnightStayHosted, r.overnightStay) : r.overnightStay;
  const stayCharge = nights * perNight;

  const lines = [
    {
      key: 'days',
      label: days === 1 ? '1 day of hire' : `${days} days of hire`,
      detail:
        days === 1
          ? `up to ${r.hoursPerDay} hours, ${r.includedKmPerDay} km included`
          : `${r.includedKmPerDay} km included each day`,
      // The same facts as `label` and `detail`, unformatted. The browser renders
      // its own wording from these; the English strings stay for the admin page
      // and for bookings stored before this existed.
      vars: { count: days, hours: r.hoursPerDay, km: r.includedKmPerDay },
      amount: money(dayCharge * vc.multiplier),
    },
  ];
  if (overtimeCharge > 0) {
    lines.push({
      key: 'overtime',
      label: `${trimNum(overtimeHours)} extra hour${overtimeHours === 1 ? '' : 's'}`,
      detail: `beyond ${days * r.hoursPerDay} hours`,
      vars: { count: overtimeHours, hours: days * r.hoursPerDay },
      amount: money(overtimeCharge * vc.multiplier),
    });
  }
  if (excessKm > 0) {
    lines.push({
      key: 'distance',
      label: `${trimNum(excessKm)} km beyond the allowance`,
      detail: `${trimNum(distanceKm)} km routed, ${includedKm} km included`,
      vars: { km: trimNum(excessKm), routed: trimNum(distanceKm), included: includedKm },
      amount: money(distanceCharge * vc.multiplier),
    });
  }

  if (stayCharge > 0) {
    lines.push({
      key: 'overnightStay',
      label:
        nights === 1
          ? "1 night — driver's overnight stay"
          : `${nights} nights — driver's overnight stay`,
      detail: hosted
        ? 'reduced — you are providing his food and lodging'
        : 'bed and meals for each night he is away',
      vars: { count: nights, hosted },
      amount: money(stayCharge),
    });
  }
  if (stopCharge > 0) {
    lines.push({
      key: 'stops',
      label: `${stops} stop${stops === 1 ? '' : 's'}`,
      detail: 'along the way',
      vars: { count: stops },
      amount: money(stopCharge),
    });
  }

  const subtotal = scaled + stopCharge + stayCharge;
  const total = roundUp(subtotal, r.roundTo);

  return {
    currency: r.currency,
    total,
    lines,
    // Everything the price was derived from, kept alongside it. A booking stores
    // this so a quote can be re-checked months later against the rate card that
    // produced it, rather than the one in force when someone asks.
    basis: {
      hours: time.hours,
      requestedHours: time.requestedHours,
      minimumHours: time.minimumHours,
      hoursDrivenBy: time.drivenBy,
      days,
      overtimeHours,
      roundedUpToDay,
      distanceKm: round2(distanceKm),
      includedKm,
      excessKm,
      nights,
      stops,
      overnightStay: stayCharge,
      driverHosted: hosted,
      overnightStayPerNight: perNight,
      daily: Boolean(trip.daily),
      vehicleClass: vc.key,
      multiplier: vc.multiplier,
    },
  };
}

/* ────────────────────────────── helpers ────────────────────────────── */

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Line amounts are whole rupees; only the total is rounded to `roundTo`. */
function money(n) {
  return Math.round(Number(n) || 0);
}

function roundUp(n, to) {
  const step = Number(to) || 1;
  return Math.ceil((Number(n) || 0) / step) * step;
}

/** 12.50 → "12.5", 12.00 → "12" — no trailing zeros in a label. */
function trimNum(n) {
  return String(round2(n));
}
