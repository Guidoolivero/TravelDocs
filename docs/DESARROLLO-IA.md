# Desarrollo con IA en TravelDocs

Esta es la fuente compartida de SDD y revision estructural para Codex, Claude, Grok y Cursor. Se aplica junto con TDD, Ponytail, Humanizer y Hallmark. Las instrucciones expresas del usuario tienen prioridad.

## SDD antes de implementar

1. Leer el pedido y el area afectada. Buscar una especificacion existente en `specs/` antes de crear otra.
2. Definir el problema, comportamiento esperado, alcance y criterios de aceptacion observables. Si falta una decision de negocio o hay requisitos contradictorios, preguntar; avanzar con el trabajo independiente.
3. Anotar el plan minimo y los archivos, interfaces y consumidores afectados. Reutilizar lo que existe antes de crear modulos, dependencias o configuraciones.
4. Implementar un criterio por vez. Para logica nueva o bugs, escribir y ejecutar primero el test que falle y luego el cambio minimo que lo hace pasar. Para HTML, estilos y configuracion, verificar el comportamiento o resultado visible.
5. Comparar el resultado con todos los criterios, revisar el diff y registrar que se probo, que fallo y que quedo pendiente. Marcar como verificado solo lo comprobado.
6. Mantener especificacion, implementacion y tests en el mismo cambio. Si el usuario corrige el comportamiento, actualizar la especificacion antes de continuar.

Para una funcionalidad, un refactor o un bug que atraviesa varios archivos, usar `specs/AAAA-MM-DD-nombre.md`, partiendo de `specs/TEMPLATE.md`. Un archivo por cambio; separar documentos solo cuando su tamano lo justifique.

Para ajustes pequenos de texto, estilos, documentacion o configuracion, alcanza una mini-spec en el chat o tarea: objetivo, alcance y comprobacion. No crear documentos de relleno ni especificaciones retrospectivas presentadas como si hubieran guiado un cambio anterior.

Una solicitud clara ya autoriza avanzar dentro de su alcance. No exigir una aprobacion adicional del plan por rutina. Respetar la rama y el tipo de deploy pedidos por el usuario; una spec no autoriza publicar ni modificar datos reales por si sola.

## Revision estructural de CaldoAI

Antes de cerrar un cambio no trivial, revisar el area modificada con los criterios de [untangle-codebase](../.agents/skills/untangle-codebase/SKILL.md):

- Ubicar logica o valores duplicados, estado global y convenciones de orden que obligan a cambiar varios lugares a la vez.
- Revisar dependencias entre modulos y consumidores que conocen detalles internos ajenos.
- Detectar wrappers sin trabajo propio, configuracion especulativa y codigo sin uso.
- Tratar cada caso especial como una pregunta sobre el requisito que lo justifica, no como algo que deba eliminarse por defecto.

Corregir los problemas introducidos por el cambio. Si un problema previo impide cumplir la spec, incluir la solucion minima y su verificacion. Registrar los hallazgos ajenos al alcance sin iniciar una limpieza general. Conservar los controles de acceso, el aislamiento entre agencias, los errores que evitan perdida de datos y las reglas SSR/FOID.

La ejecucion completa de `/untangle-codebase` requiere un pedido explicito de refactorizacion y un alcance definido en una spec. El original propone intervenir todo el repositorio y tiene opciones de limpieza de comentarios y tests: aplicar esas opciones solo si el usuario las incluyo en el pedido. La instalacion del skill no equivale a ejecutar ese refactor.

Una refactorizacion debe conservar el comportamiento pactado y pasar los tests relevantes antes y despues. Cada decision debe indicar el problema concreto, los archivos afectados y la comprobacion. Si el diff no presenta problemas estructurales, registrar ese resultado y terminar.

## Como lo leen las herramientas

| Herramienta | Entrada del proyecto |
| --- | --- |
| Codex | `AGENTS.md` → `.agents/guides/PROJECT.md` y `.codex/skills/untangle-codebase` |
| Claude Code | `CLAUDE.md` → `.agents/guides/PROJECT.md` y `.claude/skills/untangle-codebase` |
| Grok CLI | `GROK.md` / `AGENTS.md` → `.agents/guides/PROJECT.md` y `.grok/skills/untangle-codebase` |
| Cursor | `.cursor/rules/desarrollo-ia.mdc` y `.cursor/skills/untangle-codebase` |

La guia operativa completa vive en `.agents/guides/PROJECT.md`. Los archivos de
raiz son stubs de descubrimiento. Los cuatro enlaces del skill apuntan a
`.agents/skills/untangle-codebase/`. Su `SKILL.md` se conserva original; la
procedencia, revision y licencia quedan en esa carpeta. Para actualizarlo,
revisar la nueva revision y reemplazar la copia compartida, conservando las
reglas de alcance de esta guia.

Estas instrucciones viven en este proyecto. En sesiones nuevas o con instrucciones recargadas, cada herramienta debe leer su entrada. Verificar la carga en cada cliente; la existencia de archivos no prueba por si sola que una sesion ya abierta los haya incorporado.

Referencias: [SDD de GitHub Spec Kit](https://github.com/github/spec-kit/blob/main/spec-driven.md) y [skill original de CaldoAI](https://github.com/caldoai/skills/tree/main/skills/untangle-codebase). Usamos el proceso SDD; no se instala Spec Kit ni se agregan comandos que no existen en el proyecto.
