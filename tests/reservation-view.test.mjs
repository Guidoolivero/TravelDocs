import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reservationViewPassengers, passengerDetailFlags, uniqueAirlineLocators, reservationViewLayout, reservationMatchesSearch } from '../public/js/reservas/reservation-view.mjs';

describe('passengerDetailFlags', () => {
  it('desde Pasajeros muestra SSR y acciones', () => {
    assert.deepEqual(passengerDetailFlags('passengers'), { includeSSR: true, includeActions: true });
    assert.deepEqual(passengerDetailFlags(), { includeSSR: true, includeActions: true });
  });

  it('desde Check in oculta SSR y acciones', () => {
    assert.deepEqual(passengerDetailFlags('checkin'), { includeSSR: false, includeActions: false });
  });
});

describe('reservationViewPassengers', () => {
  const pax = [
    { id: 'a', lastname: 'PEREZ', firstname: 'JUAN', dob: '1980-05-12' },
    { id: 'b', lastname: 'GOMEZ', firstname: 'ANA', dob: '' },
  ];

  it('arma nombre y fecha de nacimiento de los ids de la reserva', () => {
    const list = reservationViewPassengers({ pasajeros: ['a', 'b'] }, pax);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { id: 'a', lastname: 'PEREZ', firstname: 'JUAN', dob: '1980-05-12' });
    assert.equal(list[1].dob, '');
  });

  it('omite ids que ya no estan en la base', () => {
    const list = reservationViewPassengers({ pasajeros: ['a', 'gone'] }, pax);
    assert.deepEqual(list.map(p => p.id), ['a']);
  });

  it('sin pasajeros, lista vacia', () => {
    assert.deepEqual(reservationViewPassengers({}, pax), []);
    assert.deepEqual(reservationViewPassengers({ pasajeros: [] }, pax), []);
  });
});

describe('uniqueAirlineLocators', () => {
  it('agrupa codigo con su CIA y no duplica el mismo par', () => {
    const list = uniqueAirlineLocators([
      { compania: 'AF', reservaVuelo: 'CZN6QH' },
      { compania: 'IB', reservaVuelo: 'HP8SR' },
      { compania: 'IB', reservaVuelo: 'HP8SR' },
      { compania: 'IB', reservaVuelo: 'K92TG' },
    ]);
    assert.deepEqual(list, [
      { compania: 'AF', reservaVuelo: 'CZN6QH' },
      { compania: 'IB', reservaVuelo: 'HP8SR' },
      { compania: 'IB', reservaVuelo: 'K92TG' },
    ]);
  });

  it('omite tramos sin codigo ni CIA', () => {
    assert.deepEqual(uniqueAirlineLocators([{ compania: '', reservaVuelo: '' }]), []);
    assert.deepEqual(uniqueAirlineLocators(null), []);
  });
});

describe('reservationViewLayout', () => {
  it('una CIA y un codigo: no repetir el codigo en cada tramo', () => {
    const layout = reservationViewLayout([
      { compania: 'AR', reservaVuelo: 'SAWNGB' },
      { compania: 'AR', reservaVuelo: 'SAWNGB' },
    ]);
    assert.equal(layout.locators.length, 1);
    assert.equal(layout.showLocatorOnLegs, false);
    assert.equal(layout.showAirlineOnLegs, false);
  });

  it('varias reservas: el codigo va en el tramo para saber de que CIA es', () => {
    const layout = reservationViewLayout([
      { compania: 'AF', reservaVuelo: 'CZN6QH' },
      { compania: 'IB', reservaVuelo: 'HP8SR' },
      { compania: 'IB', reservaVuelo: 'K92TG' },
    ]);
    assert.equal(layout.locators.length, 3);
    assert.equal(layout.showLocatorOnLegs, true);
    assert.equal(layout.showAirlineOnLegs, true);
  });
});



describe('reservationMatchesSearch', () => {
  const pax = [{ id: 'a', lastname: 'PEREZ', firstname: 'JUAN' }];
  const r = { pasajeros: ['a'], pendingPassengers: [{ lastname: 'NUÑEZ BARACH', firstname: 'AGUSTINA' }] };

  it('sin texto muestra todos los check-ins', () => {
    assert.equal(reservationMatchesSearch(r, pax, ''), true);
  });

  it('encuentra por pasajero vinculado', () => {
    assert.equal(reservationMatchesSearch(r, pax, 'perez'), true);
  });

  it('encuentra por pasajero sin vincular, sin importar acentos ni mayusculas', () => {
    assert.equal(reservationMatchesSearch(r, pax, 'nunez'), true);
    assert.equal(reservationMatchesSearch(r, pax, 'Agustina'), true);
  });

  it('no encuentra un nombre que no esta en el check-in', () => {
    assert.equal(reservationMatchesSearch(r, pax, 'gomez'), false);
  });
});
