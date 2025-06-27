# GitHub Actions Workflow Anpassungen

## Minimale Änderungen für Next.js + Python FastAPI Projekt

### 1. **build_image.yml**
- ✅ Dockerfile Pfad von `docker/Dockerfile` zu `./dockerfile`
- ✅ Artifact Namen von `template-rs_*` zu `rfid-app_*`
- ✅ Entfernung der ARMv7 Plattform (nur AMD64 + ARM64)
- ✅ Entfernung der Rust build-args

### 2. **deploy_image.yml**
- ✅ Artifact Pattern von `template-rs_*` zu `rfid-app_*`
- ✅ Entfernung der ARMv7 Plattform aus manifest

### 3. **pull_request_validate.yml**
- ✅ Ersetzt Rust `cargo fmt` mit ESLint für Frontend
- ✅ Ersetzt Rust `cargo clippy` mit flake8 für Backend
- ✅ Ersetzt Rust `cargo doc` mit Next.js Build
- ✅ Ersetzt Rust `cargo test` mit Python pytest
- ✅ Ersetzt Rust Cross-Compile mit Docker Build

### 4. **security_audit.yml**
- ✅ Überwacht `package.json`, `package-lock.json`, `requirements.txt`
- ✅ Nutzt `npm audit` für Frontend Security
- ✅ Nutzt `safety` für Python Security

### 5. **release.yml**
- ✅ Keine Änderungen nötig (nutzt build_image.yml)

## Was funktioniert jetzt:

### Pull Request Validation:
- Frontend: ESLint Linting + Next.js Build
- Backend: flake8 Linting + pytest Tests
- Docker: Test Build für AMD64

### Release Process:
- Automatischer Docker Build für AMD64 + ARM64
- Push zu GitHub Container Registry
- Multi-Platform Manifest

### Security Audits:
- npm audit für Node.js Dependencies
- safety check für Python Dependencies

## Keine zusätzlichen Secrets erforderlich!
Alle Workflows nutzen das automatische `GITHUB_TOKEN`.
