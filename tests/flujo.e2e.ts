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

test('alta, check-in y baja', { session: 'e2e', timeout: 240_000 }, async ({ app, screen, browser }) => {
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

// Llama a Gemini: en local no hay GEMINI_API_KEY (solo esta en el contexto
// production de Netlify). Correr contra produccion o excluir con --exclude-tag ia.
// Espera las dos fases (analisis y verificacion web) y deja en el log cuanto
// tardo cada una y si la verificacion llego a buscar en la web.
// E2E_VUELO="IB6844,EZE,MAD" cambia el vuelo (el analisis se cachea por ruta).
test('requisitos de un vuelo', { session: 'e2e', tags: ['ia'], timeout: 120_000 }, async ({ app, screen, browser }) => {
  const [vuelo, origen, destino] = (process.env.E2E_VUELO || 'AR1132,EZE,MAD').split(',');
  await app.open('/index.html');
  await screen.getByRole('button', 'Requisitos de Vuelo').tap();
  await screen.getByLabel('Número de vuelo *').fill(vuelo);
  await screen.getByLabel('Origen (IATA) *').fill(origen);
  await screen.getByLabel('Destino (IATA) *').fill(destino);
  await screen.getByLabel('Fecha de viaje').fill('2026-12-01');

  const inicio = Date.now();
  const analisis = browser.waitForResponse(/gemini-travel/, { timeout: 60_000 });
  await screen.getByRole('button', 'Consultar requisitos').tap();
  const a = await analisis;
  const msAnalisis = Date.now() - inicio;
  const verificacion = browser.waitForResponse(/gemini-travel/, { timeout: 60_000 });
  const aJson = await a.json<any>();
  expect(a.status).toBe(200);
  await expect(browser.locator('#tv-results')).toContainText(destino);

  const v = await verificacion;
  const vJson = await v.json<any>();
  console.log('[requisitos]', JSON.stringify({
    vuelo, origen, destino,
    msAnalisis,
    msTotal: Date.now() - inicio,
    analisisDeCache: !!aJson.data?._meta?.deCache,
    modelo: aJson.data?._meta?.modeloUsado,
    fuenteRuta: aJson.data?._meta?.fuenteRuta,
    verificacionStatus: v.status,
    verificoWeb: vJson.data?._meta?.verificoWeb,
    verificacionDeCache: !!vJson.data?._meta?.deCache,
    msVerificacionServidor: vJson.data?._meta?.duracionVerificacionMs,
  }));
  expect(v.status).toBe(200);
  await expect(browser.locator('#tv-results')).not.toContainText('Verificando requisitos en la web');
});
