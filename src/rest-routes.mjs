// The REST "contract": which verb and URL reaches each operation.
//
// Compare with proto/rides.proto. There, the contract is a file both sides are
// generated from and checked against. Here it's just a convention. We share this
// table between the REST server and client only to keep the lab small; in the
// real world each side would hand-write these URLs from API docs, and nothing
// would stop them drifting apart.
export const REST_ROUTES = {
  'Drivers.Nearby': { method: 'POST', path: '/drivers/nearby' }, // purists would argue GET + query string
  'Drivers.Location': { method: 'GET', path: '/drivers/current/location' },
  'Pricing.Quote': { method: 'POST', path: '/quotes' },
  'Eta.Estimate': { method: 'POST', path: '/etas' },
};
