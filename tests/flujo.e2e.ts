import { test } from '@e2e-dev/web';
import { expect, credentials, secrets } from 'e2e';

test.setup('entra a la agencia e2e', { sessions: ['e2e'] }, async ({ app, screen, session, browser }) => {
  const user = credentials.user('piloto');
  await app.open('/login.html');
  await screen.getByLabel('Email').fill(user.username);
  await screen.getByLabel('Contraseña').fill(user.password);
  await screen.getByRole('button', 'Ingresar').tap();
  await expect(screen.getByText('Ingresá el código de 6 dígitos', { exact: false })).toBeVisible();
  const alert = screen.getByRole('alert');
  let entered = false;
  for (const code of [secrets.get('totp'), secrets.get('totpPrev'), secrets.get('totpNext')]) {
    await screen.getByLabel('Código de 6 dígitos').fill(code);
    await screen.getByRole('button', 'Validar').tap();
    const result = await expect.poll(async () => {
      if ((await browser.url()).includes('index.html')) return 'ok';
      if (await alert.isVisible()) return 'bad';
      return 'pending';
    }, { timeout: 20_000 }).not.toBe('pending').then(() => browser.url());
    if (String(result).includes('index.html')) { entered = true; break; }
  }
  expect(entered).toBe(true);
  // El shell aparece cuando llega el primer snapshot. Hasta entonces #app-root esta oculto.
  await expect(screen.getByRole('button', 'Pasajeros')).toBeVisible({ timeout: 30_000 });
  await session.save('e2e');
});

test('alta, check-in, requisitos y baja', { session: 'e2e', timeout: 240_000 }, async ({ app, screen, browser }) => {
  const apellido = `E2E${Date.now().toString().slice(-6)}`;
  const nombre = 'QA';
  const ficha = `${apellido}, ${nombre}`;
  let error = null;

  async function cerrarModal() {
    const cerrar = browser.locator('.modal-overlay.open [aria-label="Cerrar"]');
    if (await cerrar.isVisible()) await cerrar.tap();
  }

  async function ir(seccion) {
    await cerrarModal();
    await screen.getByRole('button', seccion).tap();
  }

  async function borrarPasajerosE2E() {
    await ir('Pasajeros');
    for (let i = 0; i < 5; i++) {
      const fila = browser.locator('#passengers-tbody').getByRole('button').filter({ hasText: /E2E\d+/ }).first();
      if (!(await fila.isVisible())) return;
      const marca = String(await fila.textContent()).match(/E2E\d+/)?.[0];
      await fila.getByRole('button', 'Eliminar pasajero').tap();
      await screen.getByRole('button', 'Sí, eliminar pasajero').tap();
      if (marca) await expect(browser.locator('#passengers-tbody')).not.toContainText(marca, { timeout: 15_000 });
    }
  }

  // La tarjeta muestra apellido y ruta (AEP-COR), no el numero de vuelo.
  async function borrarCheckinsPrueba() {
    await ir('Check ins');
    for (let i = 0; i < 5; i++) {
      const cards = browser.locator('#reservations-list [data-open-reservation]').filter({ hasText: /AEP.+COR/ });
      const n = await cards.count();
      if (!n) return;
      await browser.onDialog('accept');
      await cards.first().getByRole('button', 'Eliminar').tap();
      await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBeLessThan(n);
    }
  }

  try {
    await app.open('/index.html');
    await browser.onDialog('accept');
    await borrarCheckinsPrueba();
    await borrarPasajerosE2E();

    await ir('Pasajeros');
    await screen.getByRole('button', '+ Nuevo pasajero').tap();
    await screen.getByLabel('Apellido *').fill(apellido);
    await screen.getByLabel('Nombre *').fill(nombre);
    await screen.getByLabel('Fecha de nacimiento *').fill('1990-01-15');
    await screen.getByRole('button', 'Guardar pasajero').tap();
    await expect(browser.locator('#passengers-tbody')).toContainText(ficha, { timeout: 15_000 });

    await ir('Check ins');
    await screen.getByRole('button', '+ Nuevo check-in').tap();
    await screen.getByLabel('Compañía aérea *').fill('AR');
    await screen.getByRole('button', '+ Agregar tramo').tap();
    await browser.locator('#res-piernas [data-field="vuelo"]').fill('AR1234');
    await browser.locator('#res-piernas [data-field="origen"]').fill('AEP');
    await browser.locator('#res-piernas [data-field="destino"]').fill('COR');
    await browser.locator('#res-piernas [data-field="fechaLocal"]').fill('2027-06-15T10:00');
    await browser.locator('#res-pax-list').getByText(ficha, { exact: false }).tap();
    await screen.getByRole('button', 'Guardar check-in').tap();
    await expect(browser.locator('#reservations-list')).toContainText(apellido, { timeout: 15_000 });
    await expect(browser.locator('#reservations-list')).toContainText(/AEP.+COR/);

    await ir('Requisitos de Vuelo');
    await screen.getByLabel('Número de vuelo *').fill('AR1300');
    await screen.getByLabel('Origen (IATA) *').fill('EZE');
    await screen.getByLabel('Destino (IATA) *').fill('MAD');
    await screen.getByLabel('Fecha de viaje').fill('2026-12-01');
    await screen.getByRole('button', 'Consultar requisitos').tap();
    await expect(browser.locator('#tv-results')).toContainText(/MAD/, { timeout: 90_000 });
  } catch (e) {
    error = e;
  } finally {
    try {
      await borrarCheckinsPrueba();
      await borrarPasajerosE2E();
    } catch (e) {
      error = error || e;
    }
  }
  if (error) throw error;
});
