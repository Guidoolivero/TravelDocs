# Import de pasajeros — doctravel-agencia → tradingdocs-mt

Copia los datos de producción al proyecto nuevo **sin modificar el origen**.

| | Proyecto | Qué pasa |
|---|----------|----------|
| **Origen** | `doctravel-agencia` | Solo lectura. No se borra ni edita nada. |
| **Destino** | `tradingdocs-mt` | Se escriben copias bajo `agencies/trading-travel/`. |

---

## Prerequisitos

1. Agencia creada en destino: `npm run migrate:seed` (ya hecho).
2. Custom claims en tu usuario: `npm run auth:set-claims` (ya hecho).
3. **Dos service accounts** (JSON fuera del repo):

| Archivo | Proyecto | Cómo obtenerlo |
|---------|----------|----------------|
| `doctravel-agencia.json` | Origen | Firebase Console → `doctravel-agencia` → ⚙ → Service accounts → Generate new private key |
| `tradingdocs-mt.json` | Destino | El que ya usás para seed/claims |

---

## Comandos

```bash
cd /Users/guidoolivero/Documents/TradingDocs/DocTravel

export GOOGLE_APPLICATION_CREDENTIALS_LEGACY="$HOME/Documents/keys/doctravel-agencia.json"
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/Documents/keys/tradingdocs-mt.json"

# 1. Simulación (no escribe nada)
npm run import:legacy:dry-run

# 2. Copia real
npm run import:legacy
```

---

## Qué copia

| Origen | Destino |
|--------|---------|
| `/passengers/{id}` | `/agencies/trading-travel/passengers/{id}` |
| `/notifications/{key}` | `/agencies/trading-travel/notifications/{key}` |

- Mismos IDs de documento (las alertas siguen funcionando).
- Si un doc **ya existe** en destino, se **omite** (no pisa).
- Los 2 pasajeros de prueba que creaste en staging se mantienen; los del origen se agregan si tienen otro ID.

---

## Verificación

1. Firebase Console → **tradingdocs-mt** → Firestore.
2. `agencies/trading-travel/passengers` → debería tener ~500+ documentos.
3. Staging → recargar → deberías ver la lista.
4. Firebase Console → **doctravel-agencia** → `/passengers` → **igual que antes**.

---

## Re-importar / actualizar

```bash
# Solo agrega documentos nuevos (no pisa existentes)
npm run import:legacy

# Sobrescribir en destino con datos del origen (origen sigue intacto)
npm run import:legacy:force
```

Usá `--force` si en producción vieja hubo cambios y querés refrescar el destino.

---

## Rollback

- **Origen:** no necesita rollback (no se tocó).
- **Destino:** borrar subcolecciones en `agencies/trading-travel/passengers` desde Console si querés empezar de cero (no afecta origen).

---

## Seguridad

- Nunca commitees los JSON de service account.
- El JSON del origen solo necesita permiso de **lectura** en Firestore (el Admin SDK lee todo; no ejecuta writes en origen desde este script).