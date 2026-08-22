# Project Management Skill

## Task Decomposition Framework

### Epic Breakdown Template
```markdown
## Epic: [Epic Name]
**Goal**: [Clear outcome statement]
**Success Metrics**: [Measurable criteria]

### Phase 1: Discovery
- [ ] Requirements gathering
- [ ] Technical feasibility assessment
- [ ] Architecture review
- [ ] Risk identification

### Phase 2: Implementation
- [ ] Backend development
- [ ] Frontend development
- [ ] API integration
- [ ] Testing

### Phase 3: Validation
- [ ] Security review
- [ ] Performance testing
- [ ] User acceptance testing
- [ ] Documentation

### Phase 4: Release
- [ ] Deployment planning
- [ ] Monitoring setup
- [ ] Rollback plan
- [ ] Stakeholder communication
```

## Estimation Guidelines

### Complexity Levels
- **XS** (< 2 hours): Simple bug fix, minor UI tweak
- **S** (2-4 hours): Single component change, straightforward feature
- **M** (1-2 days): Multi-component feature, moderate complexity
- **L** (3-5 days): Cross-cutting feature, significant refactoring
- **XL** (> 1 week): Epic-level work, requires decomposition

### Estimation Factors
1. **Technical complexity**: New patterns, unfamiliar code
2. **Dependencies**: External APIs, other teams
3. **Testing effort**: Integration tests, E2E scenarios
4. **Review overhead**: Security, architecture, compliance

## Task Prioritization Matrix

| Urgency | High Impact | Low Impact |
|---------|-------------|------------|
| **High** | Do first (P0) | Delegate (P2) |
| **Low** | Schedule (P1) | Backlog (P3) |

## Dependency Mapping

### Types of Dependencies
1. **Sequential**: Task B cannot start until Task A completes
2. **Parallel**: Tasks can run concurrently
3. **Shared Resource**: Multiple tasks need same agent/person
4. **External**: Blocked on third-party or other team

### Dependency Notation
```
Task A → Task B (sequential)
Task C ∥ Task D (parallel)
Task E → [External: API contract] (external)
```

## Risk Management

### Risk Categories
- **Technical**: Unproven approach, performance concerns
- **Resource**: Agent availability, skill gaps
- **Timeline**: Aggressive deadlines, external dependencies
- **Quality**: Insufficient testing, technical debt

### Mitigation Strategies
1. **Technical**: Spike/prototype first, consult architect
2. **Resource**: Parallelize, delegate, adjust scope
3. **Timeline**: Phased delivery, MVP approach
4. **Quality**: Automated tests, code review, security scan

## Stakeholder Communication

### Status Update Template
```markdown
## Status: [Green/Yellow/Red]
**Completed**: [What's done]
**In Progress**: [Current work]
**Blockers**: [What's stuck]
**Next**: [What's next]
**Risks**: [Emerging concerns]
```

### Escalation Triggers
- Timeline slippage > 20%
- Critical blocker > 1 day
- Security vulnerability discovered
- Scope creep without timeline adjustment
