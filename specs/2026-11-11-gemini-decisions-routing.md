# Correccion del enrutador Gemini Decision 1

Estado: verificado localmente
Rama: feat/gemini-decisions-routing

## Problema y pedido

El usuario pidio corregir la rama tras la revision. El endpoint no entra en el
bundle de produccion, usa una API inexistente en el SDK instalado, permite
peticiones sin autenticar y falla con un cuerpo JSON null.

## Comportamiento y alcance

POST /.netlify/functions/route-agent recibe { message } y devuelve route,
confidence, probabilities y type. No usa verifyAuth. Exige
Authorization: Bearer <ROUTE_AGENT_SECRET>. Si el header no coincide, responde
401 y no llama a Gemini. La consulta usa fetch de Node contra la API REST
oficial v1beta/decisions;
no requiere actualizar el SDK compartido con los otros flujos Gemini.
Contrato: https://aistudio.google.com/docs/decisions-api#quickstart
Se conserva la clasificacion cursor/claude/gemini/multiple. La integracion
con Slack y la ejecucion de agentes quedan fuera de esta correccion.

## Criterios de aceptacion

- CA-1: sin Authorization, con un Bearer distinto o sin el prefijo Bearer,
  responde 401 y no llama a Gemini. Con Bearer igual a ROUTE_AGENT_SECRET,
  clasifica el mensaje. No exige usuario, agencia ni MFA.
- CA-2: JSON null, cuerpos invalidos y mensajes vacios devuelven 400.
- CA-3: una peticion autorizada envia el contrato REST de Gemini Decision 1 y
  devuelve la clasificacion recibida; errores del proveedor y respuestas sin
  una ruta admitida y confianza valida devuelven 502 sin detalles internos.
- CA-4: el empaquetado de produccion incluye route-agent como CommonJS.
- CA-5: las pruebas del endpoint se ejecutan con npm test y la suite pasa.

## Plan minimo

Probar el handler HTTP usando la fixture Firebase existente y simular solo
el transporte externo. Renombrar la entrada a .cjs, reutilizar verifyAuth,
validar el mensaje y reemplazar el SDK incompatible por fetch. Agregar las
pruebas a package.json y comprobar el bundle real de produccion.

## Verificacion y revision

- CA-1: el test sin token fallo con 502 antes de agregar verifyAuth y paso
  con 401 despues. Tambien pasan usuario inactivo, agencia suspendida y falta
  de MFA (403), sin llamadas al proveedor.
- CA-2: el test con null reprodujo la excepcion de desestructuracion; paso
  tras validar message. Cubre primitivas, arrays, campo ausente y espacios.
- CA-3: la peticion valida fallo con 502 usando el SDK 2.8.0 y paso con REST
  simulado. Se verifican URL, API key, modelo, input, opciones y respuesta.
  Los tests de errores HTTP y respuesta invalida fallaron con 200 antes de
  agregar las validaciones; ahora devuelven 502. Tambien pasa el error de red.
- CA-4: la fixture inicialmente no encontro route-agent.cjs. El archivo
  renombrado se carga. Se ejecuto scripts/bundle-functions.mjs sin token de
  Sentry, como en CI: genero functions-dist/route-agent.cjs y termino con 0.
  El handler del bundle carga con require y devuelve 405 ante GET.
- CA-5: npm test paso: 501 tests, 0 fallos. Incluye 7 tests del endpoint.
- Revision Ponytail y estructural del diff: sin hallazgos accionables.
  Se reutiliza verifyAuth, la fixture solo expone fetch al contexto y las
  opciones del clasificador tienen una sola definicion. Sin dependencias nuevas.

## Acceso con ROUTE_AGENT_SECRET

El endpoint no usa verifyAuth ni el login de TravelDocs. Slack y MCP lo llaman
con Authorization: Bearer <ROUTE_AGENT_SECRET>. Un header ausente o distinto
devuelve 401. La validacion del message, la llamada a Decisions y los 502 no
cambian.

## Pendientes

No se publico en produccion ni se probaron mensajes reales con Gemini.
La disponibilidad del modelo y la calidad de clasificacion requieren una
prueba real. El bundle local no subio source maps ni creo releases en Sentry.
