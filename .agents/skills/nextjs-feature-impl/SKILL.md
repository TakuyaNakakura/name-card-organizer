---
name: nextjs-feature-impl
description: Use this when implementing or modifying a Next.js feature in this repo, especially when the change may touch routes, components, data fetching, API integration, or frontend-backend contracts.
---

# Goal
Implement Next.js features consistently with the repository structure and deployment model.

# Workflow
1. Inspect affected route, component tree, and data flow first.
2. Determine whether the change belongs in server components, client components, route handlers, or shared utilities.
3. Check whether the frontend depends on backend API responses, env vars, auth state, or Docker-provided runtime config.
4. Make the smallest viable change.
5. Validate with the smallest relevant checks first.
6. Summarize:
   - files changed
   - UI/API impact
   - container/runtime impact
   - validation performed

# Guardrails
- Avoid converting components to client components unless necessary.
- Preserve existing routing conventions.
- If introducing a new env variable, report it explicitly.
- If API shape changes, identify all frontend callers.