# Tooling de agentes (no es runtime)

Esta carpeta y los punteros en la raiz existen para Codex, Claude, Cursor y Grok.
Netlify no publica ni ejecuta nada de aca.

## Fuente unica de skills

`skills/` es la copia canonica (Hallmark, untangle-codebase, e2e, etc.).

Los clientes solo enlazan aca:

| Cliente | Enlace |
| --- | --- |
| Claude | `.claude/skills/*` → `.agents/skills/*` |
| Codex | `.codex/skills/*` → `.agents/skills/*` |
| Cursor | `.cursor/skills/*` → `.agents/skills/*` |
| Grok | `.grok/skills/*` → `.agents/skills/*` |

## Entradas obligatorias en la raiz del repo

Las herramientas las buscan ahi; no moverlas:

- `AGENTS.md` (Codex / Grok)
- `CLAUDE.md` (Claude Code)
- `GROK.md` (Grok; misma guia operativa)
- `.cursor/rules/` (reglas Cursor)
- `docs/DESARROLLO-IA.md` (SDD compartido)

## Lock

`skills-lock.json` (raiz) registra la revision instalada de Hallmark.
No editar a mano salvo reinstalacion del skill.
