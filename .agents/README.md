# Tooling de agentes (no es runtime)

Netlify no publica ni ejecuta nada de esta carpeta.

## Guia del proyecto

`.agents/guides/PROJECT.md` es la fuente unica. En la raiz solo quedan stubs
cortos que las herramientas descubren solas:

- `AGENTS.md` → Codex / Grok
- `CLAUDE.md` → Claude Code
- `GROK.md` → Grok

## Skills

`skills/` es la copia canonica (Hallmark, untangle-codebase, e2e, ...).

| Cliente | Enlace |
| --- | --- |
| Claude | `.claude/skills/*` → `.agents/skills/*` |
| Codex | `.codex/skills/*` → `.agents/skills/*` |
| Cursor | `.cursor/skills/*` → `.agents/skills/*` |
| Grok | `.grok/skills/*` → `.agents/skills/*` |

## Subagentes (Claude Code)

`.claude/agents/` define `ci-deploy` (Haiku), `implementador` (Sonnet) y
`revisor` (Opus). El reparto esta en `guides/PROJECT.md`, seccion
"Reparto de modelos".

## Otros

- `skills-lock.json` — revision instalada de Hallmark
- `mcp.json` — MCP e2e (la raiz tiene symlink `.mcp.json`)
