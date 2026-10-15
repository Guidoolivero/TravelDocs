import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { grok } from 'e2e/oauth/grok';
import { totp } from './tests/e2e-totp.mjs';

process.loadEnvFile('.env');

// Suscripcion SuperGrok. El login vive en ~/.config/e2e/oauth.json (npx e2e login spacexai).
const context = [
  'TravelDocs es la app de una agencia de viajes. En pantalla la marca puede decir TradingDocs.',
  'Sin sesion, la puerta es /login.html: campos Email y Contraseña, boton Ingresar.',
  'Con sesion, el menu Secciones tiene: Dashboard, Pasajeros, Check ins, Documentos, Alertas, Importar masivo, Requisitos de Vuelo, Seguridad, Ciudades.',
  'Administracion solo aparece para el super-admin de la plataforma.',
  'Pasajero es la ficha de una persona. Check ins son las reservas con tramos.',
].join(' ');

export default {
  agents: {
    default: {
      model: grok('grok-4.7'),
      system: 'Sos el QA de TravelDocs. Usa el texto visible en pantalla. No crees, edites ni borres pasajeros. No abras Administracion.',
      context,
    },
  },
  credentials: {
    piloto: {
      username: process.env.E2E_USER_EMAIL || 'e2e.qa@traveldocs.test',
      password: () => process.env.E2E_USER_PASSWORD || '',
    },
  },
  secrets: {
    totp: () => totp(process.env.E2E_TOTP_SECRET || ''),
    totpPrev: () => totp(process.env.E2E_TOTP_SECRET || '', Date.now() - 30_000),
    totpNext: () => totp(process.env.E2E_TOTP_SECRET || '', Date.now() + 30_000),
  },
  targets: [{
    engine: web({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' }),
    app: {
      // Produccion: ahi viven Auth, Firestore y las functions. La agencia de
      // prueba es agencia-e2e, no trading-travel.
      url: 'https://traveldocs.com.ar',
    },
  }],
} satisfies E2EConfig;
