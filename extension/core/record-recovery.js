import {
  focusBatches,
  focusCacheFor,
  focusCacheKey,
  normalizeFocusCache,
  normalizeFocusCaches,
  normalizeFocusConfig,
  validateFocusMarks,
} from './focus.js';

const translated = (record) =>
  record.sentences.filter((s) => typeof s.translation === 'string' && s.translation.trim()).length;
const score = (entry) =>
  (entry?.cache?.done?.length || 0) * 100000 + (entry?.cache?.marks?.length || 0);

// A caption refresh can change the sentence IDs or split only part of a video.
// Pair only unambiguous sentences with identical source text and nearby timings.
function sentencePairs(target, source) {
  const byText = new Map();
  for (const sentence of source) {
    const rows = byText.get(sentence.rawText) || [];
    rows.push(sentence);
    byText.set(sentence.rawText, rows);
  }
  const pairs = new Map(),
    used = new Set();
  const targetTextCount = new Map();
  for (const sentence of target)
    targetTextCount.set(sentence.rawText, (targetTextCount.get(sentence.rawText) || 0) + 1);
  for (const sentence of target) {
    const sameText = byText.get(sentence.rawText) || [];
    let candidates = sameText.filter(
      (other) =>
        !used.has(other.id) &&
        Math.abs(sentence.start - other.start) < 0.75 &&
        Math.abs(sentence.end - other.end) < 0.75,
    );
    // Different caption tracks can shift timestamps while preserving the
    // exact words. A unique phrase on both tracks is still safe to reuse.
    if (!candidates.length && sameText.length === 1 && targetTextCount.get(sentence.rawText) === 1)
      candidates = sameText.filter(
        (other) => !used.has(other.id) && Math.abs(sentence.start - other.start) < 15,
      );
    if (candidates.length !== 1) continue;
    const other = candidates[0];
    used.add(other.id);
    pairs.set(other.id, sentence);
  }
  return pairs;
}

function migratedCache(target, peer, entry, pairs) {
  const config = normalizeFocusConfig(entry);
  const previous = entry.cache;
  const key = focusCacheKey(target.sentences, config);
  const marks = validateFocusMarks(
    target.sentences,
    (previous.marks || []).flatMap((mark) => {
      const sentence = pairs.get(mark.sentenceId);
      return sentence ? [{ ...mark, sentenceId: sentence.id }] : [];
    }),
  );
  const covered = new Set();
  const oldBatches = focusBatches(peer.sentences);
  for (const index of previous.done || [])
    for (const sentence of oldBatches[index] || [])
      if (pairs.has(sentence.id)) covered.add(pairs.get(sentence.id).id);
  const targetBatches = focusBatches(target.sentences);
  const done = targetBatches.flatMap((batch, index) =>
    batch.every((sentence) => covered.has(sentence.id)) ? [index] : [],
  );
  return normalizeFocusCache(target.sentences, config, {
    ...previous,
    key,
    marks,
    done,
    failed: [],
    warnings: [],
    status:
      done.length === targetBatches.length
        ? 'complete'
        : done.length || marks.length
          ? 'partial'
          : 'idle',
  });
}

// Reuse derived work only when the original words and their source timings
// still agree. Notes stay attached to the record on which they were saved.
export function recoverEquivalentLearning(record, records, { translationSignature } = {}) {
  const peers = records.filter(
    (other) =>
      other.id !== record.id &&
      other.videoKey === record.videoKey &&
      other.schemaVersion === record.schemaVersion &&
      Array.isArray(other.sentences),
  );
  if (!peers.length) return { record, translations: 0, focus: 0, cacheEntries: 0 };
  let translations = 0,
    focus = 0,
    cacheEntries = 0;
  record.translationCaches ||= {};
  const candidates = peers
    .map((peer) => ({ peer, pairs: sentencePairs(record.sentences, peer.sentences) }))
    .filter((item) => item.pairs.size)
    .sort((a, b) => translated(b.peer) - translated(a.peer));
  for (const { peer, pairs } of candidates) {
    for (const [signature, cache] of Object.entries(peer.translationCaches || {})) {
      const target = (record.translationCaches[signature] ||= {});
      for (const [id, row] of Object.entries(cache || {})) {
        const sentence = pairs.get(id);
        if (
          sentence &&
          row?.source === sentence.rawText &&
          typeof row.text === 'string' &&
          row.text.trim() &&
          !target[sentence.id]
        ) {
          target[sentence.id] = structuredClone(row);
          cacheEntries++;
        }
      }
    }
    const compatible = translationSignature
      ? peer.tasks?.translation?.signature === translationSignature &&
        (!record.tasks?.translation?.signature ||
          record.tasks.translation.signature === translationSignature)
      : !record.tasks?.translation?.signature ||
        record.tasks.translation.signature === peer.tasks?.translation?.signature;
    if (compatible)
      for (const source of peer.sentences) {
        const target = pairs.get(source.id);
        if (
          target &&
          !target.translation &&
          typeof source.translation === 'string' &&
          source.translation.trim()
        ) {
          target.translation = source.translation;
          translations++;
        }
      }
    if (
      compatible &&
      pairs.size === record.sentences.length &&
      translated(peer) === peer.sentences.length &&
      translated(record) === record.sentences.length &&
      peer.tasks?.translation &&
      !record.tasks?.translation
    )
      record.tasks = { ...record.tasks, translation: structuredClone(peer.tasks.translation) };
  }
  const caches = normalizeFocusCaches(
    record.sentences,
    record.focusCaches,
    record.focusConfig,
    record.focusCache,
  );
  const before = new Map(Object.entries(caches).map(([key, entry]) => [key, score(entry)]));
  for (const { peer, pairs } of candidates) {
    const source = normalizeFocusCaches(
      peer.sentences,
      peer.focusCaches,
      peer.focusConfig,
      peer.focusCache,
    );
    for (const entry of Object.values(source)) {
      const migrated = migratedCache(record, peer, entry, pairs);
      const key = migrated.key;
      if (score({ cache: migrated }) > score(caches[key]))
        caches[key] = { goal: entry.goal, customGoal: entry.customGoal, cache: migrated };
    }
  }
  focus = Object.keys(caches).filter((key) => score(caches[key]) > (before.get(key) || 0)).length;
  if (focus) {
    record.focusCaches = caches;
    if (!record.focusConfig) {
      const peer = candidates.find(({ peer }) => peer.focusConfig);
      if (peer) record.focusConfig = normalizeFocusConfig(peer.peer.focusConfig);
    }
    if (record.focusConfig) record.focusCache = focusCacheFor(record, record.focusConfig);
  }
  return { record, translations, focus, cacheEntries };
}
