export function quoteTranslation(quote, sentences) {
  if (typeof quote.translationZh === 'string' && quote.translationZh.trim())
    return quote.translationZh.trim();
  const source = sentences.find((s) => s.id === quote.sentenceId);
  // A whole-sentence translation cannot stand in for a shorter quoted fragment.
  if (
    source?.rawText.trim() === quote.quote?.trim() &&
    /[\u3400-\u9fff]/.test(source.translation || '')
  )
    return source.translation.trim();
  return '';
}
