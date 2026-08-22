# Ergonomics Review Skill

## Code Review Checklist

### Structure and Organization
- [ ] Files are < 300 lines (split if larger)
- [ ] Functions are < 50 lines (extract if larger)
- [ ] Components have single responsibility
- [ ] Related code is co-located (components, tests, styles)
- [ ] Directory structure is intuitive

### Naming Conventions
- [ ] Variables are descriptive (no `data`, `info`, `temp`)
- [ ] Functions are verb phrases (`getUser`, `calculateTotal`)
- [ ] Booleans are clear (`isLoading`, `hasPermission`)
- [ ] Constants are UPPER_SNAKE_CASE
- [ ] Classes/components are PascalCase

### Complexity

#### Function Complexity
```javascript
// ❌ Too complex
function processUser(userData, options, flags, config) {
  // 100 lines of mixed logic
}

// ✅ Better
function processUser(userData) {
  const validated = validateUser(userData);
  const transformed = transformUser(validated);
  return saveUser(transformed);
}
```

#### Cyclomatic Complexity
- **Target**: < 10 per function
- **Warning**: 10-20 (refactor soon)
- **Critical**: > 20 (refactor immediately)

### Testability

#### Signs of Testable Code
- Pure functions (no side effects)
- Dependency injection (not hard-coded)
- Single responsibility
- Clear inputs/outputs

#### Signs of Untestable Code
- Direct database calls in business logic
- Hard-coded dependencies
- Multiple responsibilities
- Global state mutations

### Documentation

#### Function Documentation
```javascript
/**
 * Calculates the total price including tax and discounts.
 *
 * @param items - Array of cart items with price and quantity
 * @param taxRate - Tax rate as decimal (e.g., 0.21 for 21%)
 * @param discountCode - Optional discount code
 * @returns Total price rounded to 2 decimals
 * @throws {InvalidDiscountError} If discount code is invalid
 */
function calculateTotal(items, taxRate, discountCode) {
  // Implementation
}
```

#### README Sections
- [ ] Purpose and scope
- [ ] Installation/setup
- [ ] Usage examples
- [ ] API reference (if library)
- [ ] Testing instructions
- [ ] Contributing guidelines

## Refactoring Patterns

### Extract Function
```javascript
// Before
function processOrder(order) {
  // Validate
  if (!order.items || order.items.length === 0) {
    throw new Error('Empty order');
  }
  // Calculate total
  let total = 0;
  for (const item of order.items) {
    total += item.price * item.quantity;
  }
  // Apply tax
  total = total * 1.21;
  // Save
  return db.save({ ...order, total });
}

// After
function processOrder(order) {
  validateOrder(order);
  const total = calculateOrderTotal(order.items);
  const orderWithTotal = { ...order, total };
  return db.save(orderWithTotal);
}
```

### Extract Module
```javascript
// Before: 500-line component
export function Dashboard() {
  // 500 lines of mixed concerns
}

// After: Co-located modules
export function Dashboard() {
  const { data } = useDashboardData();
  const { filters } = useDashboardFilters();
  return <DashboardView data={data} filters={filters} />;
}
```

## Developer Experience Metrics

### Code Review Turnaround
- **Target**: < 24 hours for PR review
- **Warning**: 24-48 hours
- **Critical**: > 48 hours

### Build Time
- **Target**: < 2 minutes for CI
- **Warning**: 2-5 minutes
- **Critical**: > 5 minutes

### Test Execution
- **Target**: < 5 minutes for full suite
- **Warning**: 5-10 minutes
- **Critical**: > 10 minutes

### Documentation Coverage
- **Target**: > 80% of public APIs documented
- **Warning**: 50-80%
- **Critical**: < 50%

## Common Smells and Fixes

### Long Parameter List
```javascript
// ❌ Smell
function createUser(name, email, age, address, city, country, phone, role) {
  // ...
}

// ✅ Fix
function createUser({ name, email, age, address, phone, role }) {
  // ...
}
```

### Feature Envy
```javascript
// ❌ Smell: Order class knows about payment gateway
class Order {
  calculateTotal() { /* ... */ }
  chargePayment() {
    const gateway = new PaymentGateway();
    return gateway.charge(this.total);
  }
}

// ✅ Fix: Single responsibility
class Order {
  calculateTotal() { /* ... */ }
}

class PaymentService {
  chargeOrder(order) {
    const gateway = new PaymentGateway();
    return gateway.charge(order.total);
  }
}
```

### Magic Numbers
```javascript
// ❌ Smell
const total = price * 1.21 * 0.9;

// ✅ Fix
const TAX_RATE = 0.21;
const DISCOUNT_RATE = 0.1;
const total = price * (1 + TAX_RATE) * (1 - DISCOUNT_RATE);
```

## Files to Reference
- `.github/agents/ergonomics-reviewer.agent.md` — Code quality agent
- `.github/agents/agent-developer.agent.md` — Implementation agent
- `.github/skills/testing/SKILL.md` — Testing best practices
- `.github/copilot-instructions.md` — Project-wide standards
