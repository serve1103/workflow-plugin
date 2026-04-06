# Frontend Code Review Standards

## Component Structure
- Components follow single responsibility principle (one concern per component)
- Props interface is explicitly typed (no implicit any)
- Default props are defined for optional values
- Component files are in the correct directory per project convention
- Large components are decomposed into smaller, reusable pieces

## State Management
- Local state for component-only data, shared state for cross-component
- No prop drilling beyond 2 levels — use context or state management
- State updates are immutable (no direct mutation)
- Derived state is computed, not stored separately
- Loading/error/success states are handled explicitly

## Accessibility (a11y)
- Interactive elements are keyboard navigable (tab, enter, escape)
- Images have meaningful alt text (decorative images use alt="")
- Form inputs have associated labels
- Color is not the only indicator of state (icons, text as well)
- ARIA attributes are used correctly when native semantics are insufficient
- Focus management on route changes and modal open/close

## Rendering Performance
- Lists use stable, unique keys (not array index for dynamic lists)
- Expensive computations are memoized (useMemo, computed)
- Event handlers are stable references (useCallback where needed)
- Large lists use virtualization
- Images are lazy-loaded below the fold
- No unnecessary re-renders (check with React DevTools profiler)

## Styling
- Responsive design works on mobile/tablet/desktop breakpoints
- No hardcoded pixel values for spacing — use design tokens/variables
- Dark mode support if applicable
- No inline styles for reusable patterns — use CSS classes/modules
- Z-index values follow a defined scale

## Error Handling
- API call failures show user-friendly error messages
- Error boundaries catch rendering errors (React)
- Loading states prevent interaction with stale data
- Form validation provides immediate, clear feedback
- Network errors have retry/offline handling
