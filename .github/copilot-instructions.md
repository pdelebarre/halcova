# Halcova Copilot Instructions

## Project Identity
Halcova is a mobile-first PWA for cataloging and discovering books, albums, and other media. Built with React Vite, offline-first architecture, and multi-tenant SaaS capabilities.

## Core Principles
- **Offline-first**: All features work without connectivity; sync when online
- **Mobile-first**: Touch-optimized, responsive design for phones and tablets
- **Multi-tenant**: Row-level security in PostgreSQL, tenant isolation at all layers
- **Security by default**: Input validation, output encoding, RLS policies, no secrets in frontend

## Code Quality Standards
- **TypeScript preferred**: Use JSDoc types or TypeScript for new code
- **Functional components**: React hooks over class components
- **Test coverage**: Unit tests for utilities, integration tests for API layers, E2E for critical flows
- **Accessibility**: WCAG 2.1 AA compliance, semantic HTML, ARIA labels where needed

## Architecture Patterns
- **MFE-ready**: Components should be modular, avoid global state coupling
- **BFF integration**: API calls through backend-for-frontend layer, not direct to services
- **Event-driven**: Use custom events or state management for cross-component communication
- **Progressive enhancement**: Core functionality without JS, enhanced experience with JS

## Security Requirements
- **Input sanitization**: Sanitize all user input, especially for barcode/ISBN fields
- **XSS prevention**: Escape output in JSX, use DOMPurify for rich text
- **CSRF protection**: Include CSRF tokens in mutating requests
- **Dependency scanning**: Run `npm audit` and Snyk/GitHub Dependabot regularly

## Testing Strategy
- **Unit tests**: Jest + React Testing Library for components and utilities
- **API tests**: Mock fetch/axios, test retry logic and error handling
- **E2E tests**: Playwright or Cypress for critical user flows (login, scan, add to collection)
- **Security tests**: OWASP ZAP scans, RLS policy tests, penetration testing before release

## Deployment & CI/CD
- **GitHub Actions**: All CI/CD through reusable workflows in .github/workflows/
- **Netlify**: Frontend hosting with preview deployments for PRs
- **Environment variables**: Use Netlify environment variables, never commit .env files
- **Feature flags**: Use feature branches and flags for gradual rollouts

## Performance Budget
- **Bundle size**: < 200KB gzipped per MFE, lazy load non-critical code
- **LCP**: < 2.5s on 3G, < 1s on 4G
- **TTI**: < 5s on mid-range Android devices
- **Offline storage**: < 50MB per origin in IndexedDB/PouchDB

## Documentation
- **README**: Keep root README.md up to date with setup instructions
- **API docs**: Document API contracts in .github/skills/api-contracts/
- **Architecture decisions**: Log major decisions in .github/ai/ai-state.json
- **Runbooks**: Document operational procedures in .github/skills/

## Agent Usage
- Use specialized agents for specific tasks (see .github/agents/)
- Keep context focused: use #file references instead of #codebase
- Clear context between unrelated tasks with /clear or /new
- Update session memory for multi-agent workflows

---
For detailed instructions:
- Frontend: .github/frontend/.instructions.md
- Backend: .github/backend/.instructions.md
- Testing: .github/skills/testing/
- Security: .github/skills/security-auditor/
