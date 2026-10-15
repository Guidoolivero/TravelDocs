# Onboarding de agencia — Procedimiento operativo (sin panel super-admin)

Procedimiento manual para dar de alta una **nueva agencia** en DocTravel multi-tenant.  
Válido hasta Fase 4 (panel super-admin).

**Entorno:** usar siempre **staging** (`tradingdocs-mt`) para agencias de prueba. Producción solo cuando el cutover esté acordado.

---

## Resumen del flujo

```
1. Crear agencia en Firestore (agencies/{slug})
2. Crear usuario en Firebase Auth
3. Vincular users/{uid} + members/{uid} + custom claims
4. (Opcional) Seed de pasajeros iniciales
5. QA con checklist docs/QA-MULTI-TENANT.md
6. Dar credenciales al owner de la agencia
```

---

## Paso 1 — Definir datos de la agencia

| Campo | Ejemplo | Notas |
|-------|---------|-------|
| `slug` / ID | `mi-agencia` | Minúsculas, sin espacios. Es el `agencyId` permanente. |
| `name` | Mi Agencia Viajes | Nombre comercial |
| `plan` | `trial` / `starter` / `pro` | Ver plan en `PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` |
| `branding.appName` | MiAgenciaDocs | Título en la app |
| `branding.primaryColor` | `#1a4fd6` | Color sidebar/botones |
| `branding.logoUrl` | `assets/logo.jpeg` | URL relativa o absoluta |
| `alerts.email` | alertas@miagencia.com | Destino de mails de vencimiento |
| `alerts.emailjs*` | keys de EmailJS | Una cuenta EmailJS por agencia (recomendado) |

---

## Paso 2 — Agencia piloto (plantilla de referencia)

Para la **segunda agencia de QA** ya existe un script:

```bash
# Crear usuario en Firebase Console → Authentication → Add user
# Email: piloto@tuagencia.com  ·  Contraseña temporal

GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
  npm run pilot:create -- piloto@tuagencia.com --alerts-email alertas-piloto@ejemplo.com

GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
  npm run pilot:seed-passengers
```

Esto crea:
- `agencies/agencia-piloto` con branding **PilotoDocs** (naranja)
- `users/{uid}` del piloto con `agencyId: agencia-piloto`
- 5 pasajeros dummy por agencia (`PILOTO-TT-*` y `PILOTO-AP-*`)

---

## Paso 3 — Agencia nueva (genérica)

Para una agencia distinta a la piloto, replicá el patrón de `scripts/create-pilot-agency.mjs`:

1. Copiá el script o adaptá `AGENCY_ID` y `AGENCY_DOC`
2. Ejecutá con el email del **owner** (debe existir en Auth)
3. El script crea:
   - `agencies/{agencyId}`
   - `users/{uid}` con `agencyId`, `role`, `active: true`
   - `agencies/{agencyId}/members/{uid}`
   - Custom claims `{ agencyId, role }` en el JWT

**Importante:** el usuario debe **cerrar sesión y volver a entrar** para que el JWT incluya los claims.

---

## Paso 4 — Invitar más miembros

Por cada agente/admin adicional:

1. Crear usuario en Firebase Auth (email + contraseña temporal)
2. Ejecutar seed vinculando el email (mismo patrón que `linkUserToAgency` en `scripts/lib/seed-helpers.mjs`)
3. Roles válidos: `owner` · `admin` · `agent`
4. `npm run auth:set-claims` si actualizaste `users/` manualmente en Console

---

## Paso 5 — Validación

Seguí `docs/QA-MULTI-TENANT.md`:

- Aislamiento: usuario de A no ve datos de B
- Alertas al email configurado de **su** agencia
- Branding correcto al login
- Gemini operativo con `agencyId` en logs

---

## Paso 6 — Entrega al cliente

1. Enviar URL de la app (staging o prod)
2. Credenciales del owner (email + contraseña temporal → pedir cambio en primer login)
3. Confirmar que `users/{uid}` existe y `active: true`
4. Documentar en tu registro interno: `agencyId`, plan, fecha de alta

---

## Rollback / baja de agencia

| Acción | Cómo |
|--------|------|
| Suspender acceso | `users/{uid}.active = false` + `npm run auth:set-claims` |
| Suspender agencia | `agencies/{id}.status = 'suspended'` (el login rechaza agencia inactiva) |
| No borrar datos | Mantener subcolecciones para auditoría hasta política de retención (Fase 5) |

---

## Scripts disponibles

| Comando | Qué hace |
|---------|----------|
| `npm run migrate:seed` | Agencia `trading-travel` + equipo TT |
| `npm run pilot:create -- <email>` | Agencia `agencia-piloto` + usuario piloto |
| `npm run pilot:seed-passengers` | 5 pasajeros dummy × 2 agencias |
| `npm run auth:set-claims` | Sincroniza JWT claims desde `users/` |
| `npm run test:rules:emulator` | Valida aislamiento en emulador |

---

## Próximo paso (Fase 4)

Panel super-admin para crear/suspender agencias e invitar miembros desde la UI, sin scripts manuales.

---

*Complementa `docs/PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` y `docs/GUIA-WORKSPACES-PARALELOS.md`.*