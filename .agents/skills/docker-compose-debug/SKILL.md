---
name: docker-compose-debug
description: Use this when the app fails in Docker Compose, including container startup issues, dependency order problems, env mismatches, networking issues, build failures, volume issues, or cases where it works locally but not in containers.
---

# Goal
Diagnose containerized runtime problems systematically.

# Workflow
1. Identify affected services and whether failure is build-time, startup-time, networking, or runtime.
2. Inspect:
   - `docker-compose.yml`
   - service dependencies
   - env files / environment variables
   - ports
   - volumes
   - health checks
   - entrypoints / commands
3. Check logs for the failing service and directly related dependencies.
4. Distinguish between:
   - app code issue
   - container config issue
   - missing dependency / startup ordering issue
   - host/container path mismatch
5. Propose the smallest fix.
6. Report:
   - root cause
   - exact config/code change
   - how to reproduce
   - how to validate after the fix

# Guardrails
- Do not change multiple services at once unless the dependency chain requires it.
- Do not rename services, ports, or env variables without explaining why.
- Prefer explicit diagnosis over speculative broad edits.