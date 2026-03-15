---
name: github-pr-review
description: Use this when reviewing or preparing a pull request for this repo, especially for changes spanning Next.js frontend, backend APIs, Docker Compose config, environment variables, or deployment-sensitive files.
---

# Goal
Review changes with a focus on correctness, integration risk, and deployment safety.

# Review checklist
1. Confirm the change scope matches the stated intent.
2. Check for frontend/backend contract drift.
3. Check for Docker Compose or env impacts.
4. Check for accidental breaking changes in ports, service names, build steps, or runtime config.
5. Check validation evidence.
6. Produce review output with:
   - summary
   - strengths
   - risks
   - required fixes
   - optional improvements

# Guardrails
- Prioritize correctness and production safety over style-only comments.
- Flag missing validation clearly.
- Highlight rollback risks for config changes.