# Medición de requisitos durante 30 días

Medir las consultas del flujo de vuelo individual, GDS y PDF de la pantalla Requisitos. La primera consulta de análisis en producción abre una ventana compartida de 30 días. Los reinicios de Functions no deben extenderla. Cada análisis abre un documento con un identificador aleatorio antes de usar Gemini. La segunda petición usa ese identificador para completar el mismo documento. La medición es independiente de la facturación.

## Criterios de aceptación

- Registrar inicio, fin, duración, resultado y procedencia de caché por fase. Una verificación sin coincidencias es un resultado parcial incluso con HTTP 200.
- Distinguir errores, timeouts observados y fases sin cierre. Preservar la respuesta de la función si falla la medición.
- Guardar solo datos operativos. No persistir usuario, vuelo, ruta, prompts ni requisitos. Los clientes no acceden directamente a estos documentos.
- Informar cuántos análisis finalizaron y cuántas consultas completaron también la verificación. Separar caché, calcular mediana y percentil 95 de tiempos observados.
- Excluir previews y consultas iniciadas fuera de la ventana. Las consultas que empezaron dentro pueden terminar. Clientes anteriores siguen funcionando.

## Lectura de resultados

Con las credenciales de lectura de Firestore que usa el proyecto, ejecutar `node scripts/reporte-requisitos.mjs`. El documento `travelMonitoring/requisitos-30d` conserva los límites UTC y la subcolección `consultas` conserva el historial para el informe final. El cierre de la ventana detiene las altas. Una verificación en curso tiene dos minutos de gracia para empezar.

`exitoPct` divide las consultas con análisis y verificación satisfactorios por todas las abiertas. Cada fase informa estados y duraciones por separado para respuestas de caché y respuestas sin caché. `sin_iniciar` incluye verificaciones a las que el navegador nunca llegó. `sin_cierre` incluye procesos cortados, escrituras de cierre perdidas y solicitudes todavía en curso. Solo se declara timeout si se observó el vencimiento. Un HTTP 200 con requisitos base puede ser parcial.

Los tiempos se miden en el servidor. El intervalo total incluye el tiempo entre las dos peticiones y termina al resolver la verificación. No mide el último tramo de red ni el render en el navegador. El denominador empieza al recibir una consulta autenticada de la nueva pantalla; no incluye fallos de red previos, navegadores antiguos sin UUID o altas de medición que Firestore no pudo guardar.

## Revisión estructural

La ventana y las escrituras viven en el módulo de medición. La caché y el contador de cobro mantienen su esquema. El cliente genera un UUID por consulta y lo reutiliza en ambas peticiones. El documento se deriva de ese UUID y la sesión autenticada para impedir cruces entre usuarios. El informe solo lee los documentos con el SDK de administración.

## Verificación de la rama

Pasaron las pruebas de la función y del informe, incluida la pérdida de una escritura de medición. En el emulador de Firestore se observó el mismo documento antes y después de las dos fases. En navegador, el flujo local pasó el login con 2FA y usó el mismo UUID en las dos peticiones con respuestas de Gemini simuladas. La prueba no abrió la campaña en producción.
