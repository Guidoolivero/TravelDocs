import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { grok } from 'e2e/oauth/grok';
import { totp } from './tests/e2e-totp.mjs';

process.loadEnvFile('.env');

// Misma agencia e2e que e2e.config.ts, pero sirve este working tree.
// traveldocs.com.ar no tiene la pestaña hasta un deploy.
const context = [
  'TravelDocs es la app de una agencia de viajes. En pantalla la marca puede decir TradingDocs.',
  'Sin sesion, la puerta es /login.html: campos Email y Contraseña, boton Ingresar. Despues pide un codigo de 6 digitos.',
  'Con sesion, el menu Secciones tiene: Dashboard, Pasajeros, Check ins, Documentos, Alertas, Importar masivo, Requisitos de Vuelo, Seguridad, Ciudades.',
  'En Requisitos de Vuelo hay tres pestanas: Vuelo individual, Pegar segmentos GDS, Itinerario PDF.',
  'Itinerario PDF tiene el boton Adjuntar itinerario PDF. No consultes requisitos: eso llama a la IA.',
  'No crees, edites ni borres pasajeros. No abras Administracion.',
].join(' ');

export default {
  agents: {
    default: {
      model: grok('grok-4.7'),
      system: 'Sos el QA de TravelDocs. Usa el texto visible en pantalla. No crees, edites ni borres pasajeros. No abras Administracion. No pulses Consultar requisitos.',
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
    name: 'local',
    engine: web({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', viewport: { width: 1280, height: 900 } }),
    app: {
      // localhost (no 127.0.0.1): Firebase Auth lo tiene como dominio autorizado.
      url: 'http://localhost:4173',
      command: {
        executable: 'python3',
        args: ['-m', 'http.server', '4173', '--bind', '127.0.0.1', '--directory', 'public'],
        log: '.e2e/logs/app.log',
      },
    },
  }],
} satisfies E2EConfig;
