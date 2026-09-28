import { qaContext } from '../core/retrieval.js';
import { promptFor } from './prompts.js';

// Bind an explanation to its selected occurrence and evidence, not the moving playhead.
export async function explanationCacheKey(record, settings, args = {}) {
  const context = qaContext(record.sentences, {
    scope: 'sentence',
    selectedIds: args.selectedIds,
    currentTime: args.currentTime,
  });
  const input = JSON.stringify([
    'explain-v1',
    record.id,
    settings.provider,
    settings.baseUrl,
    settings.models?.explain || settings.model,
    promptFor(settings, 'explain'),
    args.selectedText,
    args.question || args.selectedText,
    args.answerLanguage || 'zh',
    args.selectedIds,
    (Array.isArray(args.history) ? args.history : []).slice(-6),
    context.map((s) => [s.id, s.rawText, s.start, s.end]),
    record.videoInfo.title,
    record.videoInfo.author,
    String(record.videoInfo.description || '').slice(0, 12000),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return (
    'explain:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  );
}
