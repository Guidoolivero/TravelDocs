---
name: verify
description: Verificar un cambio de TravelDocs corriendolo de verdad antes de commitear o abrir un PR. Elige los chequeos segun lo que toco el diff (tests, emuladores, smokes en navegador, e2e contra la app local con netlify dev) y deja escrito que se verifico y que no. Usar antes de cada commit con cambios de codigo, al pedir "verifica", "probalo", "corre la app" o antes de mergear.
---

# verify: correr el cambio, no solo leerlo

Verificar es ejecutar el cambio. Los tests unitarios no alcanzan cuando el
cambio toca un flujo que usa una persona (guardar un pasajero, marcar un
check-in, entrar con 2FA). Todo push a `main` sale en vivo para las agencias.

## 1. Elegir los chequeos por el diff

Mirar `git diff main...HEAD --stat` (y `git diff` si hay cambios sin commitear).
Correr del mas barato al mas caro; si uno falla, no seguir con los demas.

| El diff toca | Correr |
| --- | --- |
| cualquier codigo | `npm test` |
| `firebase/firestore.rules` | `npm run test:rules:emulator` |
| `netlify/functions/lib/facturacion/` o `public/js/facturacion/` | `npm run test:billing:emulator` y `npm run test:billing:ui` |
| `public/` (HTML, CSS, JS de la app) | `npm run build:frontend` y los smokes de la seccion 2 |
| un flujo con Firestore o Functions (pasajeros, check-ins, alertas, login, 2FA, requisitos) | e2e local, seccion 3 |
| solo docs o configs sin efecto en runtime | nada; decirlo en el reporte |

## 2. Smokes en navegador (servicios simulados)

Los mismos que corre el CI. Usan Chrome instalado y mocks de Firebase.

```bash
npm run build:frontend
PUBLIC_DIR=.netlify/site node tests/mfa-ui.smoke.mjs
PUBLIC_DIR=.netlify/site XLSX_QA_PATH=<copia local de xlsx@0.18.5> node tests/agency-ui.smoke.mjs
PUBLIC_DIR=.netlify/site npm run test:billing:ui
```

`XLSX_QA_PATH`: bajar una vez `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`
al scratchpad (es el mismo bundle que usa el CI).

Si se agrega una export nueva en `public/js/db.js`, los mocks de los smokes
tambien la necesitan: si no, el smoke falla al importar.

## 3. e2e contra la app local (Firebase real, agencia de prueba)

Corre el working tree contra Auth y Firestore de produccion, pero solo con
`agencia-e2e` y el usuario `e2e.qa@traveldocs.test`. Nunca contra `trading-travel`
ni otra agencia real.

Requisitos:
- `.env` con `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` y `E2E_TOTP_SECRET`. Si faltan,
  frenar y pedirselos al usuario: los crea `scripts/create-e2e-agency.mjs` con la
  service account. No inventar ni resetear credenciales.
- El runner levanta solo `netlify dev` en el puerto 8888 (sirve `.netlify/site`
  y las Functions, con las env vars del sitio linkeado). El puerto tiene que
  estar libre.

```bash
npm run build:frontend
npx e2e run --config e2e.local.config.ts tests/flujo.e2e.ts --exclude-tag ia
```

`flujo.e2e.ts` entra con 2FA, da de alta un pasajero y un check-in y borra lo
que creo. Los tests con tag `ia` llaman a Gemini: en local no hay
`GEMINI_API_KEY` (solo esta en el contexto production de Netlify), asi que se
corren contra produccion despues del deploy (`npm run test:e2e`).
Si el cambio toca otro flujo, agregar un test chico en `tests/<flujo>.e2e.ts`
con el mismo `test.setup` de login y correr ese archivo.
Resultado y capturas: `.e2e/report.json` y `.e2e/artifacts/` (el `trace.zip`
tiene la consola del navegador).

Si `netlify dev` dice "ready" pero no responde, es iCloud: `Documents` se
sincroniza y hay archivos de `node_modules` que se traban al leerlos. Por eso
`node_modules` es un enlace a `node_modules.nosync` (iCloud no sincroniza
`.nosync`). Si despues de un `npm ci` queda una carpeta real en lugar del enlace,
rehacerlo: `rm -rf node_modules.nosync && mv node_modules node_modules.nosync && ln -s node_modules.nosync node_modules`.

El agente no tipea credenciales en el navegador: el login lo hace el runner
e2e desde `.env`. Para mirar la app a mano, que el usuario entre.

## 4. Reglas

- Si un chequeo sigue fallando despues de tres intentos de arreglo, frenar y
  traer al usuario con el error completo.
- Un test inestable no se saltea, no se le agregan sleeps y no se reintenta
  hasta que pase. Si no se encuentra la causa, se dice y se deja anotado.
- No cambiar un test para que pase sin explicar por que el test estaba mal.
- Verificar el estado commiteado: si se edito algo despues de verificar,
  volver a correr lo que corresponda.

## 5. Reporte

En el mensaje al usuario y en el cuerpo del commit, una linea:

```
Verificado: npm test, billing-ui smoke, e2e flujo (local)
No verificado: envio real de EmailJS, homologacion ARCA
```

Si no se corrio nada, escribir `Verificado: ninguno` y el motivo. Nunca dar
por verificado algo que no se corrio.
