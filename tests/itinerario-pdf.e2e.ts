import { test } from '@e2e-dev/web';
import { expect, credentials, secrets } from 'e2e';

// Este archivo corre contra el working tree:
// npx e2e run --config e2e/e2e.local.config.ts tests/itinerario-pdf.e2e.ts
// traveldocs.com.ar no tiene la pestana hasta un deploy.

test.setup('entra a la agencia e2e', { sessions: ['pdf'] }, async ({ app, screen, session, browser }) => {
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
  await expect(screen.getByRole('button', 'Pasajeros')).toBeVisible({ timeout: 30_000 });
  await session.save('pdf');
});

test('el itinerario PDF deja los tramos listos', { session: 'pdf', timeout: 120_000 }, async ({ app, screen, browser }) => {
  await app.open('/index.html');
  await expect(screen.getByRole('button', 'Requisitos de Vuelo')).toBeVisible({ timeout: 30_000 });
  await screen.getByRole('button', 'Requisitos de Vuelo').tap();
  await screen.getByRole('button', 'Itinerario PDF').tap();
  await screen.getByRole('button', 'Archivo del itinerario').setInputFiles('tests/fixtures/itinerario.pdf');
  await expect(screen.getByText('4 tramos listos para consultar.')).toBeVisible({ timeout: 45_000 });
  await expect(browser.locator('#pdf-preview')).toContainText(
    /CM328[\s\S]*EZE[\s\S]*PTY[\s\S]*06OCT26[\s\S]*CM768[\s\S]*PTY[\s\S]*AUA[\s\S]*06OCT26[\s\S]*CM633[\s\S]*AUA[\s\S]*PTY[\s\S]*13OCT26[\s\S]*CM454[\s\S]*PTY[\s\S]*EZE[\s\S]*16OCT26/,
  );
  await expect(screen.getByRole('textbox', 'Fecha de viaje')).toHaveValue('2026-10-06');
  await expect(screen.getByText('PAX UNO')).toHaveCount(0);
});
