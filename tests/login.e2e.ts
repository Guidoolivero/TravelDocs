import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('el login muestra el formulario', async ({ app, screen, agent }) => {
  await app.open('/login.html');

  await expect(screen.getByRole('heading', 'Ingresar a la cuenta')).toBeVisible();
  await expect(screen.getByLabel('Email')).toBeVisible();
  await expect(screen.getByLabel('Contraseña')).toBeVisible();
  await expect(screen.getByRole('button', 'Ingresar')).toBeVisible();

  await agent.assert('se ve el formulario para ingresar con email y contraseña, sin una sesión iniciada');
});
