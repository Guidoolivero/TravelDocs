# Mejoras solicitadas por agencias

Rama: `codex/mejoras-agencias`. Revisar el PR antes de integrar a `main`: ese merge dispara el deploy de produccion.

## Que probar

1. Buscar un pasajero por `jose ber` y por `ber jose`. Debe encontrar a JOSE BERALDI aunque el nombre tenga acento. El filtro de estado sigue aplicando.
2. Generar NM y SSR en Amadeus, Sabre y Galileo con nombres como `D'ANGELO`, `MUÑOZ` o `JOSE-MARIA`. La salida usa letras A-Z y espacios: apostrofe y guion pasan a espacio (`D ANGELO`, `JOSE MARIA`), la enie a N (`MUNOZ`). Los formatos de los comandos se conservan.
3. En la ficha, Contacto de emergencia arranca vacio (como Visa / Asistencia / Viajero frecuente). Agregar, completar nombre/parentesco/telefono, guardar y volver a abrir: los datos siguen ahi. Quitar con × y guardar: queda vacio otra vez. No es obligatorio.
4. Importar el CSV usando los encabezados de la plantilla. Revisar observaciones, programas de viajero frecuente, asistencia y emergencia antes de confirmar. Los pasajeros ya existentes se omiten como antes; el import no actualiza sus fichas.
5. Cargar un itinerario con un pasajero sin ficha. El nombre del PNR queda en el check-in (sin desplegable de toda la agencia). Si la ficha existe con el mismo nombre (apóstrofe o espacio da igual: D'IMPERIO y D IMPERIO), se asocia sola. Si no, buscala abajo con + o guardá el check-in igual. No se inventan documentos ni nacionalidad.

No hay recordatorios de formularios por destino (Punta Cana, Aruba, etc.). Esa parte se saco del PR.

## Columnas nuevas del CSV

La plantilla descargable esta en `public/assets/plantilla-pasajeros.csv`. Tiene solo encabezados; agregar una fila por pasajero.

| Datos | Encabezados |
| --- | --- |
| Observaciones | `OBSERVACIONES` |
| Email | `EMAIL` |
| Contacto de emergencia opcional | `EMERGENCIA NOMBRE`, `EMERGENCIA PARENTESCO`, `EMERGENCIA TELEFONO` |
| Viajero frecuente | `FFN AEROLINEA`, `FFN NUMERO` |
| Mas programas | `FFN 2 AEROLINEA`, `FFN 2 NUMERO`, etc. |
| Asistencia | `ASISTENCIA COMPANIA`, `ASISTENCIA NUMERO`, `ASISTENCIA PRODUCTO`, `ASISTENCIA COBERTURA`, `ASISTENCIA INICIO`, `ASISTENCIA FIN`, `ASISTENCIA DURACION` |
| Mas asistencias | `ASISTENCIA 2 COMPANIA`, `ASISTENCIA 2 NUMERO`, etc. |

Para viajero frecuente usar el codigo de aerolinea (por ejemplo AA) y su numero. En Excel, dar formato de texto a numeros de programa, documentos y telefonos antes de cargarlos: si Excel ya elimino los ceros, el import no puede recuperarlos. CSV conserva los ceros escritos. Fechas: `YYYY-MM-DD` o `DD/MM/YYYY`. Se mantienen los valores iniciales existentes del import para genero y nacionalidad; revisarlos en la ficha.

No se agrego almacenamiento de contrasenas de cuentas de pasajeros. Usar un gestor de contrasenas con acceso controlado.

## Verificacion tecnica

- `npm test`: incluye busqueda, nombres GDS, CSV y pendientes.
- `TZ=UTC npm test`: comprueba que las fechas no dependan del huso del servidor.
- Prueba de navegador local, sin escrituras ni emails reales:

```sh
curl -fsSL https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js -o /tmp/agency-xlsx.min.js
XLSX_QA_PATH=/tmp/agency-xlsx.min.js node tests/agency-ui.smoke.mjs
```

Usa Chrome instalado en macOS y `playwright-core`, disponible con las herramientas e2e del proyecto. En otro sistema indicar `CHROME_PATH`. Simula Auth, Firestore y Functions; no sustituye una prueba con Firebase real.

## Preview

El frontend del preview usa el mismo proyecto Firebase que produccion. No es una base aislada: usar una agencia de pruebas. Guardar, borrar o importar desde el preview cambia sus datos reales. El flujo existente tambien puede enviar avisos de check-in al guardar; usar destinatarios de prueba.

No se desplegaron reglas ni se migraron registros. Los nuevos campos son opcionales; al volver a la version anterior dejan de verse.
