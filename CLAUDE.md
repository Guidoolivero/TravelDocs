# CLAUDE.md

Entrada para Claude Code.

1. Leer `.agents/guides/PROJECT.md` (guia operativa completa del repo).
2. Antes de implementar: `docs/DESARROLLO-IA.md` (SDD + revision estructural).
3. UI visible: `.agents/skills/hallmark/SKILL.md`.
4. Mapa de modulos: `docs/MODULOS.md`.
5. Perfil de coding corto: `docs/CLAUDE.md`.

Skills canonicos: `.agents/skills/`. Este cliente enlaza desde `.claude/skills/`.

## Delegacion a subagentes (instruccion del usuario)

Autorizo usar los subagentes de `.claude/agents/` sin pedirlo cada vez, pero solo cuando gasten menos tokens que hacerlo en la sesion principal. Un subagente arranca sin contexto y relee lo que necesita: ese costo tiene que ser menor que lo que ahorra.

Antes de cada tarea, decidir:

- **`ci-deploy` (Haiku):** esperar o revisar CI y deploys, leer logs largos, busquedas amplias. Conviene cuando la salida cruda es larga y solo importa la conclusion.
- **`implementador` (Sonnet):** un paso ya especificado con trabajo mecanico largo (varios archivos de UI, tests o copy). No conviene si son pocas ediciones o si explicarle el paso cuesta casi lo mismo que hacerlo.
- **`revisor` (Opus):** antes de mergear un PR que toca logica (fechas, alertas, reservas, `firestore.rules`, Netlify Functions). No para docs ni configs.

No delegar:
- Tareas que se resuelven con pocas llamadas a herramientas.
- Trabajo cuyo contexto ya esta cargado en la sesion principal y el subagente tendria que releer.
- Fechas y zonas horarias, `firestore.rules` / multi-tenant y SSR/FOID: los hace la sesion principal.

Al cerrar la tarea, decir en una linea si se delego, a quien y por que (o por que no).
