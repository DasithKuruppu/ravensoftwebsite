/**
 * English — the source of truth.
 *
 * Every customer-facing string lives here. The admin console is deliberately
 * absent: it is read by one person who reads English, and every future change to
 * it would otherwise need two languages.
 *
 * Keys under `line.` and `error.` mirror codes the API sends. The server returns
 * `{ key: 'overnightStay', vars: { nights: 3 } }` rather than a sentence, so the
 * browser decides the wording and the language — which is what lets a Sinhala
 * customer see a Sinhala price breakdown from an English-only pricing engine.
 *
 * `{count}` selects a plural form: `foo_one` / `foo_other`, chosen by
 * Intl.PluralRules rather than `n === 1`.
 */
export default {
  /* ── shell ── */
  'install.ready': 'Install Ravensoft Fleet for quicker booking.',
  'install.action': 'Install',
  'install.ios': 'To install: tap Share, then “Add to Home Screen”.',
  'install.dismiss': 'Not now',
  'update.ready': 'A new version is available.',
  'update.action': 'Update',
  'nav.book': 'Book',
  'nav.trips': 'My trips',
  'nav.trips.short': 'Trips',
  'nav.admin': 'Admin',
  'nav.signIn': 'Sign in',
  'footer.where': 'Ravensoft Fleet · Sri Lanka',
  'footer.note': 'Prices are estimates until a booking is confirmed. Maps and routing by Google.',

  /* ── the two ways to buy ── */
  'mode.route': 'Plan a route',
  'mode.daily': 'Just hire the car',
  'mode.driverNote': 'Every hire comes with a driver — we do not offer self-drive.',

  /* ── page heading ── */
  'book.title': 'Book a car and driver',
  'book.subtitle':
    'Full-day and multi-day trips anywhere in Sri Lanka. Tell us the route and see the price straight away.',

  /* ── route form ── */
  'route.heading': 'Where to?',
  'route.from': 'Starting from',
  'route.fromPlaceholder': 'Hotel, address or town',
  'route.to': 'Going to',
  'route.toPlaceholder': 'Where the trip ends',
  'route.addStop': '+ Add a stop along the way',
  'route.addAnotherStop': '+ Add another stop',
  'route.stop': 'Stop {n}',
  'route.stopPlaceholder': 'Where do you want to stop?',
  'route.remove': 'Remove',
  'route.waiting': 'Waiting there',
  'route.hours': 'hours',
  'route.finishHeading': 'Returning / ending at',
  'route.notReturning': 'Not returning',
  'route.oneWayNote': 'One way. The car is left at {place}.',
  'route.finishPlaceholder': 'Where the car finishes',
  'route.finishDefault': 'Back to your pickup point. Change it to finish somewhere else.',
  'route.finishEdited': 'The return leg is routed and priced on its own.',

  /* ── when and how long ── */
  'when.heading': 'When, and for how long',
  'when.pickup': 'Pick-up',
  'when.timezone': 'Sri Lanka time.',
  'when.howLong': 'How long do you need the car?',
  'when.dayNote':
    'A day is a full working day with the driver. We extend it if the route needs longer.',
  'when.suggestion':
    'This trip is about {hours} on the road — more than one driver can comfortably do in a day.',
  'when.suggestionAction': 'Make it {length}',

  /* ── durations ── */
  'duration.1': 'A day',
  'duration.2': '2 days',
  'duration.3': '3 days',
  'duration.4': '4 days',
  'duration.7': 'A week',
  'duration.14': '2 weeks',
  'duration.30': 'A month',

  /* ── vehicle and passengers ── */
  'who.heading': 'Who is travelling',
  'who.passengers': 'Passengers',
  'who.upTo': 'Up to {n} in this vehicle.',

  /* ── daily hire ── */
  'daily.heading': 'Car and driver',
  'daily.intro': 'The {vehicle} and its driver, for as many days as you need. Tell us where to collect you.',
  'daily.collect': 'Where should we collect you?',
  'daily.starting': 'Starting',
  'daily.lengthHeading': 'How long, and how far',
  'daily.days': 'Days',
  'daily.distance': 'Distance',
  'daily.included': '{km} km — included',
  'daily.allowanceNote':
    '{km} is included in {days}. Going further is {rate} a kilometre, so it is cheaper to book the distance you expect than to settle it afterwards.',

  /* ── driver hosting ── */
  'hosting.label': "I'll provide the driver's food and accommodation",
  'hosting.saves': 'Saves {perNight} a night — {total} over {nights}.',
  'hosting.savingAll': 'No overnight charge at all — saving {total}.',
  'hosting.savingPartial': 'Saving {total} — {hosted} a night instead of {full}.',
  'hosting.hotelNote': "A bed and meals for {nights}; many hotels have a driver's room.",

  /* ── route choice ── */
  'routes.heading_one': 'Route',
  'routes.heading_other': 'Routes',
  'routes.note': 'The quicker road is not always the cheaper one — expressways add distance and tolls.',
  'routes.tollNote': 'Tolls are paid by you on the day and are not in these prices.',
  'routes.via': 'via {road}',
  'routes.detail': '{km} · about {hours} driving',
  'routes.noExpressway': 'no expressway',
  'routes.outbound': 'Outbound',
  'routes.return': 'Return',
  'routes.label.fastest': 'Fastest',
  'routes.label.shortest': 'Shortest',
  'routes.label.alternative': 'Alternative',
  'routes.label.only': 'Recommended route',
  'routes.label.estimate': 'Estimated route',

  /* ── quote ── */
  'quote.total': 'Estimated total',
  'quote.empty': 'Fill in where you are going and the price appears here.',
  'quote.summary': '{length} · {km}',
  'quote.nightsAway': '{count} night away',
  'quote.nightsAway_other': '{count} nights away',
  'quote.stretched':
    'This route takes about {hours} including breaks, so the hire is priced for that rather than the {asked} you asked for.',
  'quote.approximate':
    'The routing service did not answer, so this distance is approximate. The confirmed price may differ.',
  'quote.showBreakdown': 'What makes up this price',
  'quote.hideBreakdown': 'Hide the details',
  'quote.measured': 'Distance measured along real roads. Tolls, parking and entry tickets are not included.',

  /* ── quote lines, keyed to what the server sends ── */
  'line.days_one': '1 day of hire',
  'line.days_other': '{count} days of hire',
  'line.days.detailOne': 'up to {hours} hours, {km} km included',
  'line.days.detailMany': '{km} km included each day',
  'line.overtime_one': '1 extra hour',
  'line.overtime_other': '{count} extra hours',
  'line.overtime.detail': 'beyond {hours} hours',
  'line.distance': '{km} km beyond the allowance',
  'line.distance.detail': '{routed} km routed, {included} km included',
  'line.overnightStay_one': "1 night — driver's overnight stay",
  'line.overnightStay_other': "{count} nights — driver's overnight stay",
  'line.overnightStay.detail': 'bed and meals for each night he is away',
  'line.overnightStay.detailHosted': 'reduced — you are providing his food and lodging',
  'line.stops_one': '1 stop',
  'line.stops_other': '{count} stops',
  'line.stops.detail': 'along the way',

  /* ── finishing the request ── */
  'finish.heading': 'Finish the request',
  'finish.phone': 'Phone number',
  'finish.phoneNote': 'So the driver can reach you on the day.',
  'finish.notes': 'Anything we should know?',
  'finish.optional': 'Optional',
  'finish.notesPlaceholder': 'Flight number, child seat, luggage, a stop you might add…',
  'finish.request': 'Request this trip · {total}',
  'finish.sending': 'Sending…',
  'finish.noCharge': 'Nothing is charged now. We confirm by phone, usually within a few hours.',
  'finish.signInToBook': 'Sign in to request this trip',
  'finish.kept': 'Your route and price are kept while you sign in.',
  'finish.continue': 'Continue',
  'finish.sessionExpired': 'Your session expired. Sign in again and the form will still be here.',

  /* ── how the price works ── */
  'rates.heading': 'How the price is worked out',
  'rates.day': '{amount} per {hours}-hour day, including {km} km.',
  'rates.perKm': '{amount} for each kilometre beyond that allowance.',
  'rates.overtime': '{amount} an hour past a whole day — never more than the cost of another day.',
  'rates.overnight':
    '{amount} for each night the driver stays away, on trips that do not come back the same evening.',
  'rates.included':
    'Fuel or charging, the driver and insurance are all included. Tolls, parking and entry tickets are not.',

  /* ── place field ── */
  'place.pickFromList': 'Pick a place from the list.',
  'place.noMatch': 'No place in Sri Lanka matches that. Try a nearby town.',

  /* ── my trips ── */
  'trips.title': 'My trips',
  'trips.none': 'No trips yet.',
  'trips.bookOne': 'Book one',
  'trips.signInPrompt': 'Sign in to see the trips you have booked.',
  'trips.all': 'All my trips',
  'trips.loading': 'Loading…',
  'trips.sent': 'Request sent.',
  'trips.sentNote':
    'We will call you to confirm, usually within a few hours. Quote the reference below if you get in touch first.',
  'trips.pickupAt': 'Pick-up',
  'trips.hireLength': 'Hire length',
  'trips.distance': 'Distance',
  'trips.allowance': 'Distance allowance',
  'trips.routeRow': 'Route',
  'trips.routeRowNamed': '{leg} route',
  'trips.vehicle': 'Vehicle',
  'trips.nightsAway': 'Nights away',
  'trips.driver': 'Driver',
  'trips.vehicleNumber': 'Vehicle number',
  'trips.yourNote': 'Your note:',
  'trips.quoted': 'Quoted price',
  'trips.agreed': 'Agreed price',
  'trips.wasQuoted': 'Quoted {amount}',
  'trips.cancel': 'Cancel this booking',
  'trips.cancelling': 'Cancelling…',
  'trips.cancelConfirm': 'Cancel this booking?',
  'trips.collectedHere': 'Collected here · {days} · {km} km allowance',
  'trips.andBack': 'and back',
  'trips.finishingHere': 'finishing here',
  'trips.estimatedDistance': 'Distance on this booking was estimated rather than routed.',

  /* ── status ── */
  'status.pending': 'Awaiting confirmation',
  'status.confirmed': 'Confirmed',
  'status.declined': 'Declined',
  'status.cancelled': 'Cancelled',
  'status.completed': 'Completed',

  /* ── map ── */
  'map.alt': 'Map of the route',
  'map.loading': 'Loading map…',
  'map.noKey': 'Map unavailable — no Google Maps key was set at build time.',
  'map.failed': 'The map could not be loaded{reason}. Your price is unaffected.',
  'map.estimate': 'Straight-line estimate — the routing service did not answer.',

  /* ── the fleet's vehicles, keyed to the rate card ── */
  'vehicle.baw-e7-pro': 'BAW E7 Pro',
  'vehicle.baw-e7-pro.note': 'Electric hatchback, up to 3 passengers',

  /* ── units ── */
  'unit.currency': 'LKR',
  'unit.km': '{n} km',
  'unit.hours_one': '{n} hour',
  'unit.hours_other': '{n} hours',
  'unit.days_one': '{n} day',
  'unit.days_other': '{n} days',
  'unit.daysAndHours': '{days} {hours}',

  /* ── server-side refusals, keyed to the API's error codes ── */
  'error.origin_required': 'Choose where the trip starts.',
  'error.destination_required': 'Choose where the trip ends.',
  'error.outside_service_area': '{place} is outside Sri Lanka.',
  'error.too_many_stops': 'A trip can have at most {n} stops.',
  'error.start_required': 'Choose when the trip starts.',
  'error.too_soon': "Bookings need at least {n} hours' notice. Pick a later start.",
  'error.too_far_ahead': 'Bookings open {n} days ahead.',
  'error.hours_required': 'Say how long you need the car for.',
  'error.too_short': 'The shortest hire is {n} hours.',
  'error.too_long': 'The longest hire the form can price is {n} days.',
  'error.days_required': 'Say how many days you need the car.',
  'error.allowance_too_large': 'The most we can quote in advance is {n} km. Get in touch for more.',
  'error.too_many_passengers': 'We can carry {n} passengers at the moment. Get in touch if you need more.',
  'error.too_many_passengers_bigger': 'The {vehicle} seats {n}. Pick a larger vehicle.',
  'error.phone_required': 'A phone number so the driver can reach you.',
  'error.place_unavailable': 'That place could not be located in Sri Lanka. Try a nearby town.',
  'error.not_found': 'No booking with that reference.',
  'error.not_cancellable': 'This booking is already {status}.',
  'error.unauthorized': 'Sign in to continue.',
  'error.generic': 'Something went wrong. Please try again.',
  'error.couldNotPrice': 'Could not price this trip.',
};
