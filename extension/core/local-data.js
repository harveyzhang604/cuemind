// Keep raw captions, stable sentence IDs and user edits so saved notes remain navigable.
export function clearLearningCache(record) {
  const next = structuredClone(record);
  for (const key of [
    'analysis',
    'analysisChunks',
    'studyMap',
    'studyChunks',
    'tasks',
    'focusCache',
    'focusCaches',
    'boundaryChunks',
    'interfaceTranslations',
    'translationCaches',
  ])
    delete next[key];
  next.sentences = next.sentences.map((s) => {
    delete s.translation;
    return s;
  });
  next.updatedAt = Date.now();
  return next;
}
export const dataActions = ['clear-cache', 'delete-notes', 'reset'];
