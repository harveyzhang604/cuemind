// Focus writes only its record cache; QA/explain/refine and notes write separate stores.
// Other transcript or analysis writers must remain exclusive to avoid lost record updates.
const separate = new Set(['qa', 'explain', 'refine', 'note']);
export function taskConflict(existing, next) {
  return !(
    (existing === 'focus' && separate.has(next)) ||
    (next === 'focus' && separate.has(existing)) ||
    (existing !== next && separate.has(existing) && separate.has(next))
  );
}
