# Project AI skills

Skills were copied with their supporting files from existing installations in
the owner's `grand` and `omnifaced` projects. No source project was modified.
The scan counted distinct projects, so duplicate `.claude`/`.agents` copies in
the same project did not inflate frequency. Installed frequency is a proxy for
familiarity, not a record of actual skill invocation.

| Skill | Projects found | Purpose here |
| --- | ---: | --- |
| caveman | 5 | Concise communication when requested |
| caveman-commit | 5 | Commit messages |
| caveman-compress | 5 | Compress notes when requested |
| bun-native | 4 | Bun-first tooling decisions |
| handoff | 4 | Preserve context between work sessions |
| caveman-review | 4 | Concise actionable reviews |
| cavecrew | 4 | Delegation conventions when delegation is requested |
| find-skills | 4 | Discover additional skills when needed |
| brainstorming | 4 | Clarify feature design before implementation |
| typescript-advanced-types | 3 | Public plugin types and type safety |
| domain-modeling | 3 | Core/plugin boundaries |
| writing-plans | 3 | Implementation planning |
| systematic-debugging | 2 | Investigate failures before fixing |
| verification-before-completion | 2 | Verify results before claiming completion |
| tdd | 1 | Behavior-driven test-first development |

Canonical installation: `.agents/skills/`. The local-copy manifest at
`.agents/skills.local.json` records each source project and SHA-256 of SKILL.md.
Full directories were copied rather than only SKILL.md so referenced guidance
and helper files remain available. These skills are available on the next turn.
`AGENTS.md` holds repository rules; `CLAUDE.md` imports them and points to the
same skill directory.

Existing upstream provenance: caveman/cavecrew (`juliusbrussee/caveman`),
TypeScript (`wshobson/agents`), TDD/domain modeling/handoff (`mattpocock/skills`),
find-skills (`vercel-labs/skills`), and process skills (`obra/superpowers`).
bun-native is the owner's existing project policy copied from omnicrew.

Telegram, backend, Vue/Nuxt, and project-specific skills were omitted because
this repository is a portable library. Their presence in neighboring projects
does not make them useful dependencies of the core.
