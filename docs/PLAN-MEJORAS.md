# Plan de Mejoras - DocTravel

Auditoria completa del codebase con recomendaciones priorizadas por severidad.
No se modifico ningun archivo del sistema para generar este documento.

---

## FASE 1: Correcciones Criticas (Seguridad + Accesibilidad)

---

### 1.1 Restaurar indicador de foco en formularios

**Archivos:** `css/main.css:37`, `css/login.css:150`

**Que se cambia:**

```css
/* ANTES (main.css:37) */
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; }

/* DESPUES */
input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}
```

```css
/* ANTES (login.css:150) */
input:focus-visible { outline: none; }

/* DESPUES */
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}
```

**Porque:**

La regla actual `outline: none` en `:focus-visible` elimina completamente el indicador visual de foco para usuarios que navegan con teclado (Tab, Shift+Tab). La linea 31-35 de main.css define un `:focus-visible` general correcto, pero la linea 37 lo sobreescribe para inputs/selects/textareas. Lo mismo en login.css. Sin foco visible, un usuario de teclado no sabe en que campo esta. Esto es una violacion WCAG 2.4.7 (Nivel AA) - Focus Visible. La solucion es simple: en vez de quitar el outline, aplicamos el mismo estilo que ya usa el `:focus-visible` general (outline + accent color).

---

### 1.2 Escapar IDs en atributos `onclick` inline

**Archivo:** `index.html:981,1007,1059,1077,1080,1122,1225,1232`

**Que se cambia:**

```javascript
// ANTES (linea 981)
onclick="openDetail('${a.pid}')"
onclick="openDetail('${p.id}')"
onclick="openEdit('${p.id}')"
onclick="confirmDelete('${p.id}')"
onclick="dismissAlert('${a.dismissKey}')"

// DESPUES
onclick="openDetail('${escStr(a.pid)}')"
onclick="openDetail('${escStr(p.id)}')"
onclick="openEdit('${escStr(p.id)}')"
onclick="confirmDelete('${escStr(p.id)}')"
onclick="dismissAlert('${escStr(a.dismissKey)}')"
```

**Porque:**

Los IDs de Firestore (`p.id`, `a.pid`, `a.dismissKey`) se insertan directamente dentro de atributos HTML `onclick` sin escapar. Si un ID contiene una comilla simple (`'`), comilla doble (`"`), o caracteres HTML (`<`, `>`, `&`), puede romper el atributo y crear un vector de inyeccion HTML/XSS. Aunque Firestore genera IDs alfanumericos seguros (20 chars `[a-z0-9]`), los `dismissKey` se construyen manualmente en `getAlertItems()` y podrian contener caracteres inesperados. La funcion `escStr` ya esta importada en `index.html:722` y escapa `& < > " ' \`, que es exactamente lo que necesitamos para atributos HTML. Es una correccion de seguridad preventiva de bajo costo.

---

### 1.3 Endurecer CSP eliminando `unsafe-inline` para scripts

**Archivo:** `netlify.toml:47`

**Que se cambia:**

```
# ANTES
script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net https://unpkg.com 'unsafe-inline'

# DESPUES (estrategia progresiva)
script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net https://unpkg.com 'unsafe-hashes' 'sha256-<hash_del_script_inline_principal>'
```

**Porque:**

`'unsafe-inline'` en `script-src` le dice al navegador que permita TODOS los scripts inline, lo que anula la proteccion principal del CSP contra ataques XSS. Si un atacante logra inyectar un `<script>` tag o un `javascript:` URI, el navegador lo ejecutara. La solucion requiere dos pasos:

1. Reemplazar `'unsafe-inline'` con `'unsafe-hashes'` + los hashes SHA-256 de los event handlers inline (onclick, onchange, etc.). Esto permite los handlers existentes sin abrir la puerta a scripts arbitrarios.
2. A largo plazo, migrar los 61 handlers `onclick` inline a `addEventListener` en JS (ver item 3.6), lo que permite eliminar completamente `'unsafe-hashes'`.

**Nota:** Los 61 handlers inline hacen que calcular los hashes sea impracticable a mano. La estrategia practica es:

- **Paso 1 (ahora):** Agregar un nonce. El HTML se sirve estatico desde Netlify, asi que no se pueden generar nonces dinamicamente. Alternativa: usar `'unsafe-hashes'` que es menos seguro que nonces pero mejor que `'unsafe-inline'`.
- **Paso 2 (FASE 3):** Migrar todos los handlers inline a addEventListener y entonces si eliminar `'unsafe-hashes'` completamente.

**Para `'style-src'`:** El `'unsafe-inline'` en styles es menos critico (no ejecuta JS) pero sigue siendo debilidad. Los estilos inline (`style="..."`) se usan extensivamente en el HTML. Migrar estos a clases CSS toma tiempo. Lo dejamos para FASE 3.

---

## FASE 2: Correcciones de Alto Impacto (Robustez + Consistencia)

---

### 2.1 Agregar logging en catch blocks silenciosos

**Archivos:** `netlify/functions/gemini-travel.js:76,122,266,301,329,361,375`, `netlify/functions/gemini-scan.js:116`, `index.html:1963,2225,2400`, `js/scanner.js:90`

**Que se cambia:**

```javascript
// ANTES (gemini-travel.js:76)
} catch { clearTimeout(t1); return null; }

// DESPUES
} catch (err) { clearTimeout(t1); console.error('buscarRutaVuelo fallo:', err.message); return null; }
```

```javascript
// ANTES (gemini-travel.js:361)
try { parsed = JSON.parse(raw); } catch { /* nada */ }

// DESPUES
try { parsed = JSON.parse(raw); } catch (err) { console.error('JSON.parse(raw) fallo:', err.message); }
```

```javascript
// ANTES (index.html:1963)
} catch (_) { fail++; }

// DESPUES
} catch (err) { console.error('Error importando pasajero:', err); fail++; }
```

```javascript
// ANTES (scanner.js:90)
const json = await res.json().catch(() => ({}));

// DESPUES
const json = await res.json().catch(err => { console.error('Error parseando respuesta scan:', err); return {}; });
```

**Porque:**

Hay 11 catch blocks que tragan errores sin loguear nada. Cuando algo falla en produccion, no hay forma de saber que paso. Los errores se pierden silenciosamente y el unico sintoma visible es "no funciona" o "devolvio vacio". Agregar `console.error` en cada catch cuesta casi nada en terminos de codigo, pero transforma un sistema opaco en uno debuggeable. En Netlify Functions, los `console.error` van a los logs de Netlify (Functions log), que se pueden consultar desde el dashboard. En el frontend, van a la consola del navegador. No es Sentry, pero es infinitamente mejor que silencio absoluto.

---

### 2.2 Centralizar `ALLOWED_EMAILS` eliminando la copia client-side

**Archivos:** `index.html:852-856` (eliminar), `_auth.js:7-11` (mantener como fuente unica)

**Que se cambia:**

```javascript
// ANTES (index.html:852-878)
const ALLOWED_EMAILS = [
  'guillermo@tradingtravel.com.ar',
  'guido@tradingtravel.com.ar',
  'mariela_dede@tradingtravel.com.ar'
];

// Escapa HTML...
function esc(str) { ... }

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = './login.html'; return; }
  if (!ALLOWED_EMAILS.includes(user.email?.toLowerCase())) {
    console.warn('Acceso denegado para:', user.email);
    await signOut(auth);
    window.location.href = './login.html?error=unauthorized';
    return;
  }
  ...
```

```javascript
// DESPUES (index.html)
function esc(str) { ... } // mantener

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = './login.html'; return; }
  // La verificacion real de autorizacion se hace server-side en _auth.js.
  // El check visual aqui es solo UX: redirige rapido si no esta autorizado.
  // Si se desincroniza con _auth.js, el server igual rechazara las calls.
  // Opcional: mantener una lista local para UX rapido, o directamente
  // dejar que la primera call al server rechace con 403.
  ...
```

**Estrategia:**

Hay dos opciones:

- **(A) Eliminar completamente el check client-side:** La primera llamada a una Netlify Function (scan o travel) hara el check server-side. Si no esta autorizado, devuelve 403. El frontend muestra "no autorizado" en ese momento. Pro: una sola fuente de verdad. Con: el usuario entra al dashboard y recien se entera al hacer una accion.
- **(B) Mover la lista a Firestore:** Crear un documento `/config/allowedEmails` con el array. El cliente lo lee al iniciar. `_auth.js` tambien lo lee. Una sola fuente, ambas partes sincronizadas. Pro: se puede agregar un agente sin redeploy. Con: agrega una lectura extra de Firestore.

**Porque:**

La lista esta duplicada en `index.html:852` y `_auth.js:7`. Si alguien agrega un agente en un lado y se olvida del otro, el cliente muestra "acceso denegado" (si falta en index.html) o el server rechaza las calls (si falta en _auth.js). Ambas experiencias son confusas. El check client-side ES puramente cosmetico: cualquier usuario puede abrir DevTools y borrar el array para entrar al dashboard. La seguridad real esta en `_auth.js`. Recomendacion: **Opcion (B) - Firestore**. Es la mas robusta y la que menos cambios requiere.

---

### 2.3 Cachear `passengerOverallStatus()` en el dashboard

**Archivo:** `index.html:964-966`

**Que se cambia:**

```javascript
// ANTES (lineas 964-966)
const expired = passengers.filter(p => ['expired','critical'].includes(passengerOverallStatus(p)));
const warning = passengers.filter(p => passengerOverallStatus(p) === 'warning');
const ok = passengers.filter(p => passengerOverallStatus(p) === 'ok');

// DESPUES
const statusCache = new Map(passengers.map(p => [p.id, passengerOverallStatus(p)]));
const expired = passengers.filter(p => ['expired','critical'].includes(statusCache.get(p.id)));
const warning = passengers.filter(p => statusCache.get(p.id) === 'warning');
const ok = passengers.filter(p => statusCache.get(p.id) === 'ok');
```

**Porque:**

`passengerOverallStatus(p)` recorre los 5 documentos del pasajero, llama a `docStatus()` para cada uno (que a su vez llama a `daysUntil()` + `parseDate()`), y determina el estado. Con la version actual, cada pasajero pasa por esta funcion 3 veces (una por cada `.filter()`). Con 100 pasajeros, son 300 llamadas x 5 docs = 1500 evaluaciones de fecha. Con el Map, se llama una sola vez por pasajero: 100 llamadas x 5 docs = 500 evaluaciones. La mejora es O(3n) -> O(n). No es critico con pocos pasajeros, pero es gratis en complejidad de codigo y escala linealmente.

---

### 2.4 Ajustar Gemini safety settings de `BLOCK_NONE` a `BLOCK_ONLY_HIGH`

**Archivos:** `netlify/functions/gemini-travel.js:18-23`, `netlify/functions/gemini-scan.js:44-49`

**Que se cambia:**

```javascript
// ANTES
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
];

// DESPUES
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
];
```

**Porque:**

`BLOCK_NONE` permite que Gemini procese y devuelva cualquier contenido, incluyendo contenido de alto riesgo (discurso de odio, contenido sexualmente explicito, acoso, contenido peligroso). Si bien el sistema es interno (3 usuarios) y los prompts son de requisitos de visa/OCR, `BLOCK_NONE` es innecesariamente permisivo. `BLOCK_ONLY_HIGH` bloquea solo contenido de certeza alta/muy alta en cada categoria, permitiendo contenido moderado/bajo. Esto protege contra prompts inyectados o respuestas inesperadas sin afectar la funcionalidad: los prompts de visa y OCR no generan contenido en estas categorias. Es un cambio defensivo de costo cero.

---

### 2.5 Eliminar imports muertos

**Archivo:** `index.html:722`

**Que se cambia:**

```javascript
// ANTES
import { docStatus, statusBadge, passengerOverallStatus, fmtDate, fmtDateGDS, daysUntil, initials, escStr } from './js/utils.js';

// DESPUES
import { docStatus, statusBadge, passengerOverallStatus, fmtDate, initials, escStr } from './js/utils.js';
```

**Porque:**

`fmtDateGDS` y `daysUntil` se importan en `index.html:722` pero no se usan en ningun lugar de `index.html`. `fmtDateGDS` se usa en `js/ssr.js` (que lo importa directamente de `utils.js`). `daysUntil` tampoco tiene uso en `index.html`. Imports muertos incrementan el parseo del modulo innecesariamente y confunden a quien lee el codigo (hace pensar que se usan). Eliminarlos reduce el bundle y aclara dependencias.

---

### 2.6 Reemplazar `.substr()` deprecado por `.slice()`

**Archivo:** `js/utils.js:95`

**Que se cambia:**

```javascript
// ANTES
return Date.now().toString(36) + Math.random().toString(36).substr(2,5);

// DESPUES
return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
```

**Porque:**

`String.prototype.substr()` esta deprecado en el estandar ECMAScript (Annex B - compatibilidad hacia atras). Los motores modernos aun lo soportan, pero puede ser removido en futuras versiones. `.slice(2,7)` es identico en comportamiento (`substr(2,5)` = 5 chars desde posicion 2; `slice(2,7)` = desde posicion 2 hasta 7 exclusive = 5 chars) y es el metodo estandar. Cero riesgo funcional.

---

## FASE 3: Mejoras Estructurales (Accesibilidad + Consistencia)

---

### 3.1 Agregar atributo `for` a labels y `id` a inputs

**Archivo:** `index.html` (~40+ labels en lineas 275-297, 362-394, 480-570, 1484-1618)

**Que se cambia:**

```html
<!-- ANTES -->
<div class="form-group">
  <label>GDS</label>
  <select id="ssr-gds" onchange="regenerateSSR()">...</select>
</div>

<!-- DESPUES -->
<div class="form-group">
  <label for="ssr-gds">GDS</label>
  <select id="ssr-gds" onchange="regenerateSSR()">...</select>
</div>
```

**Porque:**

Sin `for` en el `<label>`, los screen readers no pueden anunciar que campo describe cada label. Un usuario con NVDA/JAWS oye "GDS" pero no puede saber si es un input, select, o textarea, ni saltar al campo con click en el label. La mayoria de los inputs ya tienen `id` (ej: `id="ssr-gds"`) asi que solo falta agregar `for="ssr-gds"` al label. En los casos donde el input no tiene `id`, se agrega uno. Esto es WCAG 1.3.1 (Info and Relationships) y 4.1.2 (Name, Role, Value). El cambio es mecanico pero extenso (~40 labels).

---

### 3.2 Hacer clickeables los elementos interactivos por teclado

**Archivo:** `index.html:458,981,1007,1059,1122,1232,220`

**Que se cambia:**

```html
<!-- ANTES (linea 458 - dropzone) -->
<div class="scan-dropzone" id="scan-dropzone"
     onclick="document.getElementById('scan-file').click()" ...>

<!-- DESPUES -->
<div class="scan-dropzone" id="scan-dropzone"
     role="button" tabindex="0"
     onclick="document.getElementById('scan-file').click()"
     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('scan-file').click()}"
     ...>
```

```html
<!-- ANTES (linea 1059 - fila de pasajero) -->
<tr style="cursor:pointer;" onclick="openDetail('${escStr(p.id)}')">

<!-- DESPUES -->
<tr style="cursor:pointer;" tabindex="0" role="button"
    onclick="openDetail('${escStr(p.id)}')"
    onkeydown="if(event.key==='Enter')openDetail('${escStr(p.id)}')">
```

**Porque:**

Los `<div>` y `<tr>` con `onclick` no son naturalmente enfocables ni activables por teclado. Un usuario que navega con Tab nunca llega a estos elementos. Con `tabindex="0"` el elemento entra al orden de tabulacion. Con `onkeydown` para Enter/Space, se activa con teclado. Con `role="button"`, los screen readers lo anuncian como boton. Esto es WCAG 2.1.1 (Keyboard) y 4.1.2 (Name, Role, Value). Afecta ~6 elementos en el HTML.

---

### 3.3 Unificar la funcion `esc()` eliminando duplicados

**Archivos:** `index.html:859,2489,2621,2734`

**Que se cambia:**

```javascript
// ANTES (linea 859 - definicion global)
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ANTES (linea 2489 - redefinicion local dentro de renderGDSPreview)
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ANTES (linea 2621 - otra redefinicion local en renderStopPanel)
const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ANTES (linea 2734 - otra en renderTravelResult)
const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// DESPUES - una sola definicion global que reemplaza a todas
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
// Y eliminar las 3 redefiniciones locales (lineas 2489, 2621, 2734)
// Las funciones locales ya no son necesarias
```

**Porque:**

Hay 4 versiones de `esc()` con comportamiento inconsistente:

- La global (859) usa DOM para escapar `& < >` (pero no `"` ni `'`)
- La local en 2489 escapa `& < >` a mano (sin `"` ni `'`)
- Las locales en 2621 y 2734 escapan `& < > "` a mano (pero no `'`)

Ya tienen `escStr()` importada de `utils.js` (linea 722) que escapa los 5 caracteres + backslash. La funcion global `esc()` via DOM (`div.textContent`) escapa `& < >` automaticamente, pero NO `"` ni `'` porque el browser no los necesita en contenido de texto (solo en atributos). Sin embargo, los resultados de `esc()` se usan tanto en contenido como en atributos inline, lo que es inconsistente.

La solucion: mantener `esc()` para contenido de texto (seguro via DOM) y usar `escStr()` para atributos HTML. Eliminar las 3 redefiniciones locales que solo existen porque el scope las oculta de la global. Cada redefinicion local es un lugar donde alguien penso "necesito escapar comillas dobles" pero no lo hizo de forma consistente.

---

### 3.4 Agregar handler global de errores `unhandledrejection`

**Archivo:** `index.html` (nuevo bloque en el script principal)

**Que se cambia:**

```javascript
// Agregar despues de Firebase init (despues de linea ~727)
window.addEventListener('unhandledrejection', event => {
  console.error('Promesa rechazada sin catch:', event.reason);
});
window.addEventListener('error', event => {
  console.error('Error no capturado:', event.error || event.message);
});
```

**Porque:**

Hoy no hay ningun handler global. Si una promesa se rechaza sin un `.catch()` (por ejemplo, un bug futuro en una funcion async), el error se muestra en la consola como "Uncaught (in promise)" pero no hay punto de captura centralizado. Con estos listeners, todos los errores no capturados pasan por un punto unico. A futuro, este es el lugar donde se conectaria Sentry u otro servicio de monitoreo. Por ahora, `console.error` es suficiente para no perder errores en produccion.

---

### 3.5 Migrar handlers `onclick` inline a `addEventListener`

**Archivo:** `index.html` (61 handlers inline)

**Que se cambia:**

Ejemplo representativo:

```html
<!-- ANTES -->
<button class="btn btn-primary" onclick="savePassenger()">Guardar</button>

<!-- DESPUES -->
<button class="btn btn-primary" id="btn-save-passenger">Guardar</button>
```

```javascript
// En el bloque JS del script principal:
document.getElementById('btn-save-passenger').addEventListener('click', savePassenger);
```

**Porque:**

Hay 61 handlers `onclick` inline en el HTML. Esto tiene tres problemas:

1. **Seguridad:** Cada handler inline requiere `'unsafe-inline'` o `'unsafe-hashes'` en el CSP (ver item 1.3). Migrar a `addEventListener` permite eliminar completamente esas directivas.
2. **Separacion de intereses:** La logica de comportamiento no deberia estar mezclada con el markup. Dificulta el mantenimiento y la busqueda de codigo.
3. **Consistencia:** El codebase mezcla 4 estilos de event binding: `onclick` inline, `addEventListener`, `window.onX`, y `.onclick`. Unificar en `addEventListener` es el estandar moderno.

Este es el cambio mas extenso de la FASE 3. Se recomienda hacerlo de forma incremental: primero los handlers mas criticos (botones de formularios, navegacion), luego los de las tablas dinamicas.

---

### 3.6 Refactorizar `index.html` en modulos ES

**Archivo:** `index.html` (2857 lineas)

**Que se cambia:**

Dividir el script principal en modulos:

```
js/
  app.js          — Inicializacion Firebase, auth, routing
  dashboard.js    — renderDashboard()
  passengers.js   — CRUD de pasajeros, tabla, filtros
  documents.js    — renderDocuments()
  alerts.js       — getAlertItems(), renderAlerts(), dismissAlert()
  ssr-view.js     — renderSSRView(), regenerateSSR()
  travel.js       — consultarVuelo(), renderTravelResult(), renderStopPanel()
  import.js       — Importacion masiva, groupByPassenger()
  scanner-ui.js   — UI del scanner (dropzone, previews)
  forms.js        — openNew(), openEdit(), savePassenger(), etc.
  utils.js        — (existente) helpers compartidos
  db.js           — (existente) CRUD Firestore
  config.js       — (existente) configuracion
  scanner.js      — (existente) OCR
  ssr.js          — (existente) generacion SSR
```

```html
<!-- ANTES (index.html) -->
<script type="module">
  // 2857 lineas de JS inline
</script>

<!-- DESPUES (index.html) -->
<script type="module" src="./js/app.js"></script>
```

**Porque:**

`index.html` tiene 2857 lineas que contienen TODA la logica de la aplicacion: dashboard, CRUD de pasajeros, gestion de documentos, alertas, import/export, generacion SSR, parser GDS, integracion de scanner, y requisitos de viaje. Un archivo monolitico de este tamano:

- Es dificil de navegar y mantener
- No se puede hacer code review efectivo
- No permite tree-shaking ni lazy loading
- Dificulta el testing unitario
- Cualquier cambio toca el mismo archivo, generando conflictos de merge

La migracion puede hacerse de forma incremental: extraer un modulo a la vez, verificar que funciona, y continuar. El HTML queda solo con markup y el tag `<script type="module" src="./js/app.js">`. Este es el cambio de mayor esfuerzo estimado (4-8 horas) pero con mayor impacto en mantenibilidad a largo plazo.

---

## Resumen de Prioridades

| # | Item | Fase | Impacto | Esfuerzo | Riesgo si no se hace |
|---|------|------|---------|----------|---------------------|
| 1.1 | Restaurar focus-visible | 1 | Accesibilidad critica | 2 min | Usuarios de teclado no pueden usar el sistema |
| 1.2 | Escapar IDs en onclick | 1 | Seguridad XSS | 10 min | Vector de inyeccion HTML |
| 1.3 | Endurecer CSP | 1 | Seguridad XSS | 30 min | Permite ejecucion de scripts inyectados |
| 2.1 | Logging en catch blocks | 2 | Debuggeabilidad | 15 min | Errores silenciosos en produccion |
| 2.2 | Centralizar ALLOWED_EMAILS | 2 | Consistencia | 30 min | Desincronizacion de permisos |
| 2.3 | Cachear passengerOverallStatus | 2 | Performance | 5 min | O(3n) innecesario |
| 2.4 | Ajustar safety settings | 2 | Seguridad defensiva | 2 min | Procesa contenido danino |
| 2.5 | Eliminar imports muertos | 2 | Limpieza | 2 min | Nada critico, codigo mas limpio |
| 2.6 | Reemplazar .substr() | 2 | Mantenibilidad | 1 min | Deprecacion futura |
| 3.1 | Labels con `for` | 3 | Accesibilidad AA | 30 min | Screen readers no asocian labels |
| 3.2 | Elementos clickeables por teclado | 3 | Accesibilidad AA | 20 min | Usuarios de teclado no pueden navegar |
| 3.3 | Unificar esc() | 3 | Consistencia/seguridad | 10 min | Escaping inconsistente = posible XSS |
| 3.4 | Handler global de errores | 3 | Observabilidad | 5 min | Errores perdidos en produccion |
| 3.5 | Migrar onclick a addEventListener | 3 | Seguridad + mantenibilidad | 2-3 hrs | CSP debilitado permanentemente |
| 3.6 | Refactorizar index.html en modulos | 3 | Mantenibilidad | 4-8 hrs | Monolito inmanejable a largo plazo |

**Tiempo total estimado:**

- FASE 1: ~42 minutos
- FASE 2: ~53 minutos
- FASE 3: ~3.5 - 6 horas
- **Total: ~5 - 8 horas**

---

## To-Do List

### FASE 1 — Correcciones Criticas
- [x] 1.1 Restaurar focus-visible en formularios (`css/main.css`, `css/login.css`)
- [x] 1.2 Escapar IDs en atributos `onclick` inline (`index.html`)
- [x] 1.3 Endurecer CSP eliminando `unsafe-inline` (`netlify.toml`) — requiere completar 3.5 primero

### FASE 2 — Alto Impacto
- [x] 2.1 Agregar logging en catch blocks silenciosos (`gemini-travel.js`, `gemini-scan.js`, `index.html`, `scanner.js`) — **complemento aplicado:** `scanner.js:90` `.catch(() => ({}))` reemplazado por `.catch(err => { console.error(...); return {}; })` y `scanner.js:103` `catch {}` reemplazado por `catch (err) { console.error(...); ... }`
- [x] 2.2 Centralizar ALLOWED_EMAILS — eliminada copia client-side, fuente unica en `_auth.js`
- [x] 2.3 Cachear `passengerOverallStatus()` en el dashboard (`index.html`)
- [x] 2.4 Ajustar Gemini safety settings a `BLOCK_ONLY_HIGH`
- [x] 2.5 Eliminar imports muertos (`fmtDateGDS`) en `index.html`
- [x] 2.6 Reemplazar `.substr()` deprecado por `.slice()` en `js/utils.js`

### FASE 3 — Mejoras Estructurales
- [x] 3.1 Agregar atributo `for` a labels y `id` a inputs (~39 labels + IDs dinamicos en visa/FFN)
- [x] 3.2 Hacer clickeables por teclado los elementos interactivos (`div`, `tr` con onclick)
- [x] 3.3 Unificar la funcion `esc()` eliminando 3 redefiniciones locales (`index.html`)
- [x] 3.4 Agregar handler global de errores `unhandledrejection` + `error` (`index.html`)
- [x] 3.5 Migrar 61 handlers `onclick` inline a `addEventListener` (2-3 hs) — **fix aplicado:** `js/ssr.js:198` tenia `onclick="copyText(this,'...')"` que violaba CSP. Migrado a `data-copy-ssr` + handler delegado existente en `index.html:1042-1047`
- [ ] 3.6 Refactorizar `index.html` en modulos ES (4-8 hs)

**Progreso: 14 / 15 items completados**

---

## 3.6 Detalle: Refactorizar `index.html` en modulos ES

**Estado actual:** `index.html` tiene ~2996 lineas totales, de las cuales ~2280 son JS inline dentro de un unico `<script type="module">`. Los ~713 lines restantes son HTML markup.

### Diagnostico

| Metrica | Valor |
|---------|-------|
| Lineas JS inline | ~2280 |
| Bloques funcionales identificados | 13 |
| Funciones adjuntas a `window.*` | 40 |
| Elementos DOM unicos referenciados | 95 |
| Elementos DOM compartidos entre bloques | ~32 |
| Variables de estado mutables top-level | 5 |
| Dependencias cruzadas entre bloques | ~42 simbolos |

### Estructura de modulos objetivo

```
js/
  store.js       — NUEVO: estado compartido (passengers, listeners, evento de cambio)
  modals.js      — NUEVO: openModal(), closeModal(), showToast(), copyText()
  alerts.js      — NUEVO: getAlertItems(), renderAlerts(), dismissAlert(), updateAlertBadge(), email alerts
  dashboard.js   — NUEVO: renderDashboard()
  passenger-list.js — NUEVO: renderPassengers(), renderDocuments(), setDocFilter()
  passenger-form.js — NUEVO: openNew(), openEdit(), savePassenger(), confirmDelete(), openDetail(), visa/FFN
  scanner-ui.js  — NUEVO: dropzone, drag/drop, preview, processScannedFiles(), mergeIdentity()
  bulk-import.js — NUEVO: handleImportDrop(), groupByPassenger(), renderImportReview(), saveImportedPassengers()
  travel.js      — NUEVO: consultarVuelo(), renderTravelResult(), parsearGDS(), renderStopPanel()
  main.js        — NUEVO: Firebase init, auth, event wiring, bootstrap
  config.js      — EXISTENTE
  db.js          — EXISTENTE
  utils.js       — EXISTENTE
  ssr.js         — EXISTENTE
  scanner.js     — EXISTENTE
```

### Riesgos principales

1. **`passengers` (51 refs en 11 bloques):** La unica variable que lee casi todo. Necesita un store con evento `onchange` para que los modulos reaccionen sin importarse entre si.
2. **Event wiring (~200 lineas, 85 addEventListener):** Un solo bloque registra listeners que llaman funciones de 5+ modulos. Al extraer, cada modulo registra sus propios listeners.
3. **`window.*` (40 funciones):** Todas existen por los antiguos handlers inline. Ya eliminados (item 3.5), pero las referencias quedan. Al modularizar, se eliminan y se exportan nombradamente.
4. **Scanner → Form acoplamiento:** `scanner-ui.js` llama `addVisaEntry()` que vive en `passenger-form.js`. Solucion: evento custom o import directa.

### Fases de implementacion (1 dia cada una)

---

#### FASE A: Infraestructura + modulos sin dependencias (Dia 1)

**Objetivo:** Crear `store.js` y `main.js`. Extraer los 3 modulos mas aislados que no dependen de `passengers` ni de otros bloques.

| Tarea | Archivo nuevo | Lineas estimadas | Riesgo |
|-------|---------------|-----------------|--------|
| Crear `js/store.js` con `passengers`, `currentEditId`, `ssrSelectedPassenger`, listeners, evento `onchange` | `js/store.js` | ~40 | Alto (es la base de todo) |
| Extraer `openModal()`, `closeModal()`, `showToast()`, `copyText()` | `js/modals.js` | ~37 | Bajo |
| Extraer `consultarVuelo()`, `renderTravelResult()`, `parsearGDS()`, `selectTravelStop()` | `js/travel.js` | ~440 | Bajo (solo lee `auth.currentUser`) |
| Extraer `handleImportDrop()`, `groupByPassenger()`, `renderImportReview()`, `saveImportedPassengers()` | `js/bulk-import.js` | ~225 | Bajo (solo lee `passengers` del store) |
| Crear `js/main.js` con Firebase init, auth listener, import de todos los modulos | `js/main.js` | ~80 | Medio |

**Validacion:** App carga. Travel e Import funcionan. Dashboard/passengers/forms todavia en index.html pero importan `store.js` para leer `passengers`.

**Tiempo estimado:** 3-4 horas

---

#### FASE B: Alertas + Dashboard + Lista (Dia 2)

**Objetivo:** Extraer los modulos de visualizacion que leen `passengers` del store.

| Tarea | Archivo nuevo | Lineas estimadas | Riesgo |
|-------|---------------|-----------------|--------|
| Extraer `getAlertItems()`, `renderAlerts()`, `dismissAlert()`, `updateAlertBadge()`, email alerts | `js/alerts.js` | ~259 | Medio (cross-refs con dashboard) |
| Extraer `renderDashboard()` | `js/dashboard.js` | ~63 | Bajo |
| Extraer `renderPassengers()`, `renderDocuments()`, `setDocFilter()` | `js/passenger-list.js` | ~108 | Bajo |

**Validacion:** Dashboard muestra stats. Alertas funcionan. Lista de pasajeros renderiza. Filtros funcionan.

**Tiempo estimado:** 2-3 horas

---

#### FASE C: Formulario + Scanner UI (Dia 3)

**Objetivo:** Extraer los 2 bloques mas acoplados. Este es el dia mas dificil.

| Tarea | Archivo nuevo | Lineas estimadas | Riesgo |
|-------|---------------|-----------------|--------|
| Extraer `openNew()`, `openEdit()`, `savePassenger()`, `confirmDelete()`, `openDetail()`, visa/FFN helpers | `js/passenger-form.js` | ~442 | Alto (es el bloque mas grande, cruza con scanner) |
| Extraer `onDragOver/Drop/Leave()`, `onFileSelected()`, `processScannedFiles()`, `mergeIdentity()`, preview UI | `js/scanner-ui.js` | ~333 | Alto (llama `addVisaEntry` de passenger-form) |

**Acoplamiento Scanner → Form:** `scanner-ui.js` llama `addVisaEntry()` al detectar una visa escaneada. Opciones:
- **(A) Import directa:** `scanner-ui.js` importa `addVisaEntry` de `passenger-form.js`. Simple, acoplado.
- **(B) Evento custom:** `scanner-ui.js` emite `CustomEvent('scan:visa-detected')`, `passenger-form.js` escucha. Desacoplado, mas codigo.

**Recomendacion:** Opcion A. Son modulos del mismo dominio (UI de un pasajero). No vale la pena el overhead de eventos custom para 1 llamada.

**Validacion:** Crear pasajero nuevo. Editar pasajero. Escanear documento. Escanear visa. Guardar. Borrar.

**Tiempo estimado:** 3-4 horas

---

#### FASE D: Limpieza + Event wiring + Eliminar window.* (Dia 4)

**Objetivo:** Mover todo el event wiring a `main.js`. Eliminar las 40 `window.*`. Dejar `index.html` solo con HTML + `<script type="module" src="./js/main.js">`.

| Tarea | Detalle | Riesgo |
|-------|---------|--------|
| Mover event wiring a `main.js` | ~85 addEventListener que hoy estan en el script inline. Cada modulo registra los suyos propios | Medio |
| Eliminar `window.*` | Las 40 funciones pasan a ser exports nombrados. Los `.onclick` restantes (2) usan imports directos | Bajo |
| Limpiar script inline de `index.html` | Eliminar todo el `<script type="module">` inline, reemplazar por `<script type="module" src="./js/main.js">` | Medio |
| Eliminar `esc()` global | Ya existe `escStr()` en `utils.js`. Reemplazar las ~75 llamadas a `esc()` por `escStr()` | Bajo (mecanico) |
| QA completo | Navegar toda la app: login, dashboard, pasajeros, documentos, alertas, SSR, scanner, import, travel | - |

**Validacion:** `index.html` solo tiene HTML + 1 tag script. Cero JS inline. Cero `window.*`. Todas las vistas funcionan. CSP sha256 se puede recalcular (solo cubre el tag script vacio, o se elimina si ya no hay inline scripts).

**Tiempo estimado:** 2-3 horas

---

#### FASE E: Ajuste CSP + Verificacion final (Dia 5)

**Objetivo:** Aprovechar que ya no hay JS inline para simplificar el CSP.

| Tarea | Detalle | Riesgo |
|-------|---------|--------|
| Recalcular/eliminar sha256 en CSP | Si `index.html` ya no tiene script inline, `script-src` solo necesita `'self'` + los 3 dominios de CDN. Sin sha256, sin unsafe-hashes | Bajo |
| Verificar que `style-src 'unsafe-inline'` aun es necesario | Revisar si quedan estilos inline suficientes para justificarlo. Si se migraron a clases, se puede endurecer | Bajo |
| QA final en produccion (deploy preview) | Verificar en Netlify deploy preview que CSP no bloquea nada | - |

**Validacion:** CSP final: `script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net https://unpkg.com;` sin hashes, sin unsafe. La app funciona completa.

**Tiempo estimado:** 1-2 horas

---

### Resumen de tiempos por dia

| Dia | Fase | Tiempo | Riesgo |
|-----|------|--------|--------|
| 1 | A: Store + modulos aislados | 3-4 hs | Medio |
| 2 | B: Alertas + Dashboard + Lista | 2-3 hs | Bajo |
| 3 | C: Formulario + Scanner | 3-4 hs | Alto |
| 4 | D: Limpieza + Event wiring | 2-3 hs | Medio |
| 5 | E: CSP + QA final | 1-2 hs | Bajo |
| **Total** | | **11-16 hs** | |

### Reglas para cada dia

1. **Un modulo a la vez.** Extraer, probar, commitear. No extraer 2 modulos sin verificar el primero.
2. **Si algo falla, revertir.** El script inline es el backup. Si un modulo no funciona, volver al inline y debuggear.
3. **No cambiar comportamiento.** Solo mover codigo. No refactorizar logica dentro de las funciones durante la extraccion.
4. **Cada dia termina con la app funcionando.** Si el dia 3 se complica, el formulario puede quedar parcialmente extraido mientras el resto funciona.
5. **`store.js` es intocable una vez creado.** Su interfaz (getters/setters/evento) no cambia entre dias. Todos los modulos dependen de el.

---

## Firebase — ¿Se requieren cambios?

**Respuesta corta: No. Para todos los cambios implementados hasta ahora no se requiere tocar Firebase.**

### Detalle por item

| Item | Requiere Firebase | Detalle |
|------|-------------------|---------|
| 1.1 a 1.3 | No | CSS y configuracion HTTP (netlify.toml) |
| 2.1 a 2.6 | No | JS puro / Netlify Functions |
| 3.1 a 3.4 | No | HTML/JS frontend |
| 3.5 a 3.6 | No | Refactor frontend |

### Unico caso que SI implicaria Firebase: item 2.2 (opcion alternativa no implementada)

El item 2.2 fue implementado como **Opcion A**: se elimino la copia client-side de `ALLOWED_EMAILS` y la autorizacion queda solo en `netlify/functions/_auth.js` (server-side). La seguridad real ya estaba ahi; lo que se elimino fue una copia cosmetica que podia desincronizarse.

Existe una **Opcion B** (no implementada) que usaria Firestore como fuente unica de verdad:

**Cuando elegir Opcion B:**
- Necesitas agregar o quitar un agente/usuario sin hacer un nuevo deploy en Netlify.
- El cambio debe ser inmediato (el deploy de Netlify tarda ~1 min, pero si los cambios de acceso son frecuentes, Firestore es mas comodo).

**Que requeriria implementar Opcion B:**
1. Crear documento en Firestore: `/config/allowedEmails` con campo `list: ["email1@...", "email2@..."]`
2. Actualizar `netlify/functions/_auth.js` para leer el documento en vez del array hardcodeado
3. Actualizar `onAuthStateChanged` en `index.html` para leer el documento y redirigir rapido si el email no esta autorizado (es UX, no seguridad — la seguridad sigue en el server)

**Recomendacion actual: quedarse con Opcion A.** El equipo es de 3 personas y los cambios de acceso son raros. Opcion B agrega una lectura extra de Firestore en cada login sin beneficio real para ese volumen. Si el equipo crece, migrar a Opcion B en ese momento.

---

## Hallazgos adicionales (no incluidos en fases)

| Item | Detalle | Prioridad futura |
|------|---------|-----------------|
| Firebase config hardcoded | `js/config.js` tiene todos los valores hardcodeados. No usa env vars. Firebase API keys son publicas por diseno, pero authDomain/projectId deberian ser configurables por ambiente | Baja |
| Nombres mezclados ES/EN | `nacionalidad` vs `passengers`, `consultarVuelo` vs `savePassenger`. Convencion inconsistente | Baja |
| 4 estilos de event binding | `onclick` inline, `addEventListener`, `window.onX`, `.onclick`. Se unifica con item 3.5 | Baja (resuelto por 3.5) |
| Sin tests | No existe infraestructura de testing. Ni unitarios, ni e2e, ni integracion | Media |
| Sin monitoreo de errores | No hay Sentry, LogRocket, ni similar. Los errores en produccion son invisibles sin abrir DevTools | Media |
| `gemini-travel.js` hace 2 calls secuenciales | La busqueda de ruta y el analisis de requisitos son secuenciales por dependencia de datos (no se pueden paralelizar). Pero se podria agregar caching por vuelo para evitar calls duplicadas | Baja |
| Tesseract.js cargado desde CDN | Se carga desde cdn.jsdelivr.net y unpkg.com. Si ambos CDN caen, el fallback OCR no funciona. Considerar bundlear localmente | Baja |
| Sin README | No hay documentacion de setup, deploy, o arquitectura del proyecto | Media |

---

## Lectura Rápida

Estoy de acuerdo con el diagnostico general y con la priorizacion. Los problemas mas claros son accesibilidad rota por `outline: none`, riesgo de XSS por `onclick` inline y deuda estructural por tener toda la logica concentrada en `index.html`.

Matices que dejaria anotados para no sobreprometer el plan:

- La estrategia de CSP no queda realmente resuelta mientras siga existiendo un bloque grande de JS inline en `index.html`; primero hay que sacar handlers y logica a modulos o el endurecimiento va a quedar a medias.
- La centralizacion de `ALLOWED_EMAILS` es correcta como objetivo, pero conviene elegir una unica fuente de verdad con una decision explicita entre UX rapida y validacion server-side.
- Varias mejoras de Fase 3 son correctas, pero son refactors estructurales de alcance mayor; conviene tratarlas como una etapa aparte y no como un simple hardening.

En resumen: el plan esta bien armado, la secuencia de Fase 1 y Fase 2 tiene sentido, y las observaciones mas fuertes son las de seguridad, accesibilidad y mantenimiento.
