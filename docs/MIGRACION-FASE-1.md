# Migración Fase 1 — Fundación multi-tenant

**Estado del código:** implementado en repo.  
**Pendiente en Firebase:** ejecutar scripts y publicar reglas (pasos abajo).

---

## Qué cambió en el código

| Archivo | Cambio |
|---------|--------|
| `firestore.rules` | Aislamiento por `users/{uid}.agencyId` |
| `firestore.indexes.json` | Índices (vacío por ahora) |
| `firebase.json` | Config para deploy de rules |
| `js/db.js` | Rutas `/agencies/{agencyId}/passengers\|notifications` |
| `js/tenant.js` | Constantes y sessionStorage de `agencyId` |
| `js/app.mjs` | Resuelve tenant al login |
| `scripts/seed-trading-travel.mjs` | Crea agencia + users + members |
| `scripts/migrate-to-multi-tenant.mjs` | Copia datos legacy |

---

## Orden de ejecución (producción)

Hacer en **ventana de mantenimiento corta** (~15 min). Tener backup antes.

### 0. Prerequisitos

1. **Backup** de Firestore (Firebase Console → Firestore → Import/Export, o `gcloud firestore export`).
2. **Service Account** con rol `Firebase Admin SDK Administrator Service Agent`:
   - Firebase Console → Project settings → Service accounts → Generate new private key
   - Guardar JSON fuera del repo (nunca commitear).
3. Variables locales para scripts:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/ruta/a/service-account.json"
# o
export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
```

### 1. Instalar dependencias

```bash
cd /Users/guidoolivero/Documents/TradingDocs/DocTravel
npm install
```

### 2. Seed agencia Trading Travel

Crea `agencies/trading-travel`, `users/{uid}` y `members/{uid}`.

```bash
npm run migrate:seed
```

Si algún email no existe en Firebase Auth, crearlo en Console y re-ejecutar.

### 3. Migrar datos (dry-run primero)

```bash
npm run migrate:dry-run
npm run migrate:data
```

Verificar en Firebase Console que existen documentos en:
- `agencies/trading-travel/passengers`
- `agencies/trading-travel/notifications`

### 4. Publicar reglas Firestore

```bash
# Requiere firebase-tools instalado globalmente o npx
npx firebase deploy --only firestore:rules --project doctravel-agencia
```

O copiar manualmente el contenido de `firestore.rules` en Firebase Console → Firestore → Rules → Publish.

### 5. Deploy app en Netlify

Deploy del código actualizado (con `db.js` scoped).

### 6. Validar Trading Travel

- [ ] Login con los 3 usuarios
- [ ] Lista de pasajeros visible (mismos datos)
- [ ] Crear / editar / borrar pasajero
- [ ] Alertas y notificaciones funcionan
- [ ] Scanner y Gemini operativos

### 7. Limpiar legacy (opcional, después de validar)

```bash
npm run migrate:data -- --delete-legacy
```

Luego eliminar el bloque legacy en `firestore.rules` (comentario `Rutas legacy`) y volver a publicar rules.

---

## Tests locales

```bash
npm test              # tests unitarios existentes
npm run test:rules    # skip si no hay emulador (CI rápido)
npm run test:rules:emulator   # requiere Java 21+ instalado
```

`test:rules:emulator` levanta el Firestore Emulator y valida aislamiento entre agencias A y B.

---

## Rollback

Si algo falla después del cutover:

1. Revertir deploy Netlify al release anterior (lee `/passengers` legacy).
2. Publicar reglas anteriores (solo `auth != null` en `/passengers`).
3. Los datos legacy siguen intactos si no ejecutaste `--delete-legacy`.

---

## Notas Fase 2

- El fallback `DEFAULT_AGENCY_ID = 'trading-travel'` en `app.mjs` es temporal.
- Fase 2 reemplazará el fallback con lookup obligatorio en `login.js`.
- `_auth.js` sigue con whitelist hasta Fase 2.

---

*Complementa `docs/PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` y `docs/GUIA-WORKSPACES-PARALELOS.md`.*