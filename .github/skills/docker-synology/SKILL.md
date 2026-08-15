# Docker and Synology

Use for local and NAS deployment design.

## Rules

- Prefer Docker Compose over Kubernetes on the DS918+ unless justified.
- Use multi-stage builds and non-root containers where possible.
- Put database data on a dedicated persistent volume.
- Provide health checks and restart behaviour.
- Separate local, staging and production configuration.
- Use HTTPS and a hardened reverse proxy for external access.
- Document backup, restore, update and rollback.
- Keep secrets out of images and source control.
