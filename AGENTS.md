# AGENTS.md

## Project overview
This repository contains a containerized web application with:
- frontend: Next.js
- backend: API service
- orchestration: Docker Compose
- source control and review workflow: GitHub

## Core working rules
- Prefer minimal, local changes over broad refactors.
- Follow the existing directory structure and naming conventions.
- Before adding dependencies, check whether the same goal can be achieved with the current stack.
- When changing both frontend and backend, clearly explain the contract change.

## Source of truth
- Read `README.md` first.
- Then inspect `docker-compose.yml`.
- For frontend work, inspect `frontend/package.json`, `frontend/src/`, and related config files first.
- For backend work, inspect `backend/` entrypoints, dependency files, and API routes first.

## Container-first workflow
- Assume the app should run through Docker Compose unless the task explicitly says otherwise.
- Prefer verifying behavior inside containers rather than only on the host machine.
- If a bug is environment-dependent, check service definitions, ports, volumes, env files, health checks, and startup order.

## Implementation policy
- For Next.js:
  - preserve app/router conventions already used in the repo
  - prefer server/client boundaries already established in the codebase
  - avoid unnecessary client components
- For backend:
  - preserve API contract unless the task requests a breaking change
  - if API response changes, update the frontend usage points too

## Validation
After code changes, run the smallest relevant validation first.
Typical order:
1. targeted type/lint/test checks
2. container build if affected
3. docker compose run for impacted service(s)
4. end-to-end manual verification steps if relevant

## Expected checks
When relevant, consider commands like:
- `docker compose ps`
- `docker compose logs --tail=200 <service>`
- `docker compose build <service>`
- `docker compose up -d`
- frontend lint/typecheck/test commands from package.json
- backend test/lint commands from the backend service

## GitHub workflow
- Keep commits scoped and understandable.
- Summaries should mention:
  - what changed
  - why
  - any env or migration impact
  - how it was validated
- For PR-style summaries, include risk areas and rollback considerations when applicable.

## Do not
- Do not rewrite unrelated files.
- Do not upgrade framework versions unless explicitly requested.
- Do not silently change ports, env names, or service names without reporting it.
- Do not assume host-only execution is sufficient when the repository is container-first.