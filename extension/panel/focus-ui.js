import {
  normalizeFocusConfig,
  normalizeFocusCache,
  focusCacheKey,
  selectFocusConfig,
  effectiveFocusMarks,
  focusParts,
  parseGlossary,
} from '../core/focus.js';

const labels = {
  off: '关闭',
  cet4: '四级备考',
  cet6: '六级备考',
  ielts: '雅思备考',
  toefl: '托福备考',
  medical: '医学',
  finance: '金融',
  technology: '计算机',
  custom: '自定义',
};
const $ = (s) => document.querySelector(s);
function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
export function createFocusUI({
  getRecord,
  getTime,
  getTabId,
  rpc,
  isExt,
  onRender,
  onError,
  onClose,
  onOverlayPreference,
  toast,
}) {
  let config = normalizeFocusConfig({}),
    cache = null,
    cacheBook = null,
    recordId = null,
    epoch = 0,
    focusBusy = false,
    saveQueue = Promise.resolve(),
    pollTimer = null;
  let partsById = new Map(),
    frozenId = null,
    frozenParts = null,
    overlayVersion = 0,
    saveRevision = 0,
    pendingOverlayClose = false,
    analysisRun = null;
  function recordCurrent(id, version) {
    return Boolean(id && id === recordId && version === epoch && getRecord()?.id === id);
  }
  function stopPolling(run) {
    if (run?.timer) {
      clearInterval(run.timer);
      if (pollTimer === run.timer) pollTimer = null;
      run.timer = null;
      return;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  function abandonAnalysis(run) {
    if (!run) return;
    run.cancelled = true;
    stopPolling(run);
    if (run.dispatched && !run.cancelSent && run.id) {
      run.cancelSent = true;
      rpc('CANCEL', { recordId: run.id, capability: 'focus' }).catch(() => {});
    }
  }
  const entry = node('button', 'text-btn focus-entry');
  entry.id = 'focus-settings';
  entry.type = 'button';
  entry.setAttribute('aria-haspopup', 'dialog');
  entry.setAttribute('aria-controls', 'focus-dialog');
  entry.title = '设置字幕重点：选择目标、调整重点字号；点击后可查看并修改这些设置';
  const entryValue = node('span', 'focus-entry-value');
  entry.append(entryValue);
  $('.focus-entry-group').append(entry);
  const hint = node('div', 'focus-inline-status');
  hint.id = 'focus-inline-status';
  hint.hidden = true;
  $('#sentences').before(hint);
  const dialog = node('dialog', 'focus-dialog');
  dialog.id = 'focus-dialog';
  dialog.setAttribute('aria-labelledby', 'focus-title');
  dialog.setAttribute('aria-describedby', 'focus-description');
  dialog.innerHTML = `<button type="button" class="close" id="focus-close" aria-label="关闭字幕重点设置">×</button><h2 id="focus-title">字幕重点设置</h2><p id="focus-description" class="focus-description">这里控制字幕重点和字号。各目标的分析分别保存，切回自动恢复。未分析的目标显示普通字号；点击“分析重点词”才会调用模型。自定义术语和字号立即生效。</p>
 <label>重点目标<select id="focus-goal">${Object.entries(labels)
   .map(([value, label]) => `<option value="${value}">${label}</option>`)
   .join('')}</select></label>
 <label id="focus-custom-label" hidden>你想重点学习什么？<textarea id="focus-custom" rows="2" maxlength="2000" placeholder="例如：跨境电商中的谈判和物流表达"></textarea></label>
 <div class="focus-size-row"><label>侧栏字号<input id="focus-size" type="range" min="12" max="28" step="1"><output id="focus-size-value"></output></label></div>
 <div class="focus-size-row"><label>视频原文字号<input id="focus-video-size" type="range" min="14" max="48" step="1"><output id="focus-video-size-value"></output></label><label>视频译文字号<input id="focus-video-translation-size" type="range" min="12" max="48" step="1"><output id="focus-video-translation-size-value"></output></label></div>
 <label class="focus-check"><input type="checkbox" id="focus-overlay"> 在视频上显示 CueMind 字幕</label><label id="focus-overlay-language-label">视频字幕<select id="focus-overlay-language"><option value="original">原文</option><option value="bilingual">双语</option><option value="translated">译文</option></select></label><p class="focus-disclosure">选择双语或译文后，读取视频时会自动分批翻译全片；已完成的译文会逐步显示并保存在本机，模型服务可能收费。</p>
 <p class="focus-scale">普通 <span data-focus-level="1">一级重点</span> <span data-focus-level="2">二级重点</span> <span data-focus-level="3">三级重点</span></p>
 <details class="focus-terms"><summary>自定义术语与已掌握词</summary><label>术语表 · 每行一个词或短语，冒号后填写 1 / 2 / 3<textarea id="focus-glossary" rows="4" placeholder="working capital: 3&#10;cash flow: 2&#10;revenue: 1"></textarea></label><label>已掌握 · 每行一个词或短语<textarea id="focus-mastered" rows="3" placeholder="取消这些词的重点显示"></textarea></label></details>
 <p class="focus-disclosure">AI 按目标和语境估计相关性，不代表官方考试词表。自定义术语立即生效；基础字号无需 AI。</p>
 <p id="focus-progress" role="status"></p><div class="row"><button id="focus-analyze" class="primary" type="button">分析重点词</button><button id="focus-cancel" type="button" class="text-btn" hidden>取消分析</button><button id="focus-save" class="text-btn" type="button">保存并关闭</button></div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => onClose?.());
  function safe(fn) {
    return (...args) =>
      Promise.resolve()
        .then(() => fn(...args))
        .catch((e) => {
          message(e.message || String(e));
          onError(e);
        });
  }
  function message(text) {
    $('#focus-progress').textContent = text;
  }
  function goalStatus() {
    return config.goal === 'off'
      ? '重点显示已关闭'
      : cache?.done?.length || cache?.marks?.length
        ? `${labels[config.goal]} · 已保留 ${cache.done.length}/${cache.total} 批分析、${cache.marks.length} 条重点${cache.status === 'complete' ? '，分析完成' : ''}${cache.warnings?.length ? `；${cache.warnings.length} 句标注无效（${cache.warnings[0].error}），显示普通字号` : ''}`
        : `${labels[config.goal]} · 尚未分析${config.glossary.length ? '，仅显示自定义术语' : ''}`;
  }
  function updateControls() {
    entryValue.textContent =
      config.goal === 'off' ? '关闭' : labels[config.goal].replace('备考', '');
    entry.setAttribute(
      'aria-label',
      '重点：' + entryValue.textContent + '。点击设置字幕重点、字号和视频字幕显示',
    );
    document.documentElement.style.setProperty('--caption-size', config.baseSize + 'px');
    $('#focus-custom-label').hidden = config.goal !== 'custom';
    $('#focus-overlay-language-label').hidden = !config.overlay;
    $('#focus-size-value').textContent = config.baseSize + ' px';
    $('#focus-video-size-value').textContent = config.videoSize + ' px';
    $('#focus-video-translation-size-value').textContent = config.videoTranslationSize + ' px';
    $('#focus-cancel').hidden = !focusBusy;
    $('#focus-analyze').disabled = focusBusy || config.goal === 'off';
    $('#focus-analyze').textContent = cache?.status === 'partial' ? '重试未完成批次' : '分析重点词';
    for (const id of [
      'focus-goal',
      'focus-custom',
      'focus-glossary',
      'focus-mastered',
      'focus-size',
      'focus-video-size',
      'focus-video-translation-size',
      'focus-overlay',
      'focus-overlay-language',
      'focus-save',
    ])
      $('#' + id).disabled = focusBusy;
    hint.hidden = !focusBusy && !cache?.failed?.length;
    hint.replaceChildren();
    let status = focusBusy
      ? `重点词分析 ${cache?.done?.length || 0}/${cache?.total || '…'} 批`
      : cache?.failed?.length
        ? `${cache.failed.length} 批重点词未完成：${cache.failed[0].error}。可重试`
        : cache?.status === 'complete'
          ? `重点词分析完成${cache.warnings?.length ? `；${cache.warnings.length} 句未标注` : ''}`
          : cache?.status === 'cancelled'
            ? '已取消，完成的重点词已保留'
            : '';
    if (focusBusy) status += ' · 取消后可修改设置';
    if (status) {
      hint.append(node('span', '', status));
      if (focusBusy || cache?.failed?.length) {
        const b = node('button', 'text-btn', focusBusy ? '取消' : '重试');
        b.onclick = safe(() => (focusBusy ? cancel() : analyze()));
        hint.append(b);
      }
      message(status);
    }
    if (!focusBusy) message(goalStatus());
  }
  function fill() {
    $('#focus-goal').value = config.goal;
    $('#focus-custom').value = config.customGoal;
    $('#focus-size').value = config.baseSize;
    $('#focus-video-size').value = config.videoSize;
    $('#focus-video-translation-size').value = config.videoTranslationSize;
    $('#focus-overlay').checked = config.overlay;
    $('#focus-overlay-language').value = config.overlayLanguage || 'bilingual';
    $('#focus-glossary').value = config.glossary.map((x) => `${x.term}: ${x.level}`).join('\n');
    $('#focus-mastered').value = config.mastered.join('\n');
    updateControls();
  }
  function read() {
    return normalizeFocusConfig({
      ...config,
      goal: $('#focus-goal').value,
      customGoal: $('#focus-custom').value,
      baseSize: Number($('#focus-size').value),
      videoSize: Number($('#focus-video-size').value),
      videoTranslationSize: Number($('#focus-video-translation-size').value),
      overlay: $('#focus-overlay').checked,
      overlayLanguage: $('#focus-overlay-language').value,
      glossary: parseGlossary($('#focus-glossary').value),
      mastered: $('#focus-mastered')
        .value.split(/\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
  }
  function recompute(force = false) {
    const record = getRecord();
    if (!record || record.id !== recordId) return;
    const marks = effectiveFocusMarks(
      record.sentences,
      cache?.key === focusCacheKey(record.sentences, config) ? cache.marks : [],
      config,
    );
    partsById = new Map(record.sentences.map((s) => [s.id, focusParts(s, marks)]));
    if (force) {
      frozenId = null;
      frozenParts = null;
    }
    updateControls();
    onRender(force);
    sendOverlay(force).catch((e) => {
      if (config.overlay) message('视频字幕暂未连接：' + e.message + '。侧栏仍可使用。');
    });
  }
  function parts(sentence) {
    const next = partsById.get(sentence.id) || [{ text: sentence.rawText, level: 0 }];
    // Cache updates must not make the currently displayed cue change size mid-sentence.
    const t = getTime(),
      playing = t >= sentence.start && t < sentence.end;
    if (playing) {
      if (frozenId !== sentence.id) {
        frozenId = sentence.id;
        frozenParts = next;
      }
      return frozenParts;
    }
    return next;
  }
  function renderText(sentence) {
    const fragment = document.createDocumentFragment();
    for (const part of parts(sentence)) {
      if (!part.level) fragment.append(document.createTextNode(part.text));
      else {
        const span = node('span', 'focus-word', part.text);
        span.dataset.focusLevel = String(part.level);
        span.title = `${part.level} 级重点 · ${config.glossary.some((g) => g.term.toLowerCase() === part.text.toLowerCase()) ? '自定义术语' : 'AI 估计的目标相关词'}`;
        fragment.append(span);
      }
    }
    return fragment;
  }
  async function sendOverlay(refreshCurrent = false) {
    const record = getRecord(),
      target = getTabId();
    if (
      !isExt ||
      !target ||
      !record ||
      record.id !== recordId ||
      record.videoInfo.platform === 'demo'
    )
      return;
    const version = ++overlayVersion;
    const command = {
      action: 'focusCaptions',
      refreshCurrent,
      videoKey: record.videoKey,
      enabled: config.overlay,
      baseSize: config.videoSize,
      translationSize: config.videoTranslationSize,
      language: config.overlayLanguage || 'bilingual',
      sentences: config.overlay
        ? record.sentences.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            rawText: s.rawText,
            translation: s.translation || '',
            parts: parts(s),
          }))
        : [],
    };
    try {
      await rpc('PLAYER_COMMAND', { tabId: target, command });
    } catch (e) {
      if (version === overlayVersion && config.overlay) throw e;
    }
  }
  async function sync() {
    const record = getRecord();
    if (!record) {
      await leave();
      cache = null;
      cacheBook = null;
      partsById.clear();
      return;
    }
    if (record.id === recordId) {
      if (
        cacheBook?.sentences !== record.sentences ||
        (record.focusCache?.key === focusCacheKey(record.sentences, config) &&
          JSON.stringify(record.focusCache.marks) !== JSON.stringify(cache?.marks))
      ) {
        await refresh(true);
      }
      return;
    }
    if (analysisRun) abandonAnalysis(analysisRun);
    analysisRun = null;
    stopPolling();
    pendingOverlayClose = false;
    const version = ++epoch;
    recordId = record.id;
    focusBusy = false;
    cache = null;
    partsById.clear();
    frozenId = null;
    const data =
      isExt && record.videoInfo.platform !== 'demo'
        ? await rpc('GET_FOCUS', { recordId: record.id })
        : JSON.parse(localStorage.getItem('cuemind-focus-demo') || 'null');
    if (version !== epoch || getRecord()?.id !== record.id) return;
    config = normalizeFocusConfig(data?.config || {});
    cache = normalizeFocusCache(record.sentences, config, data?.cache);
    cacheBook = {
      sentences: record.sentences,
      focusConfig: config,
      focusCache: cache,
      focusCaches: data?.focusCaches || record.focusCaches || {},
    };
    fill();
    recompute(true);
    onOverlayPreference?.();
  }
  async function refresh(force = false) {
    const id = recordId,
      version = epoch,
      revision = saveRevision;
    if (!id) return;
    const data = await rpc('GET_FOCUS', { recordId: id });
    const record = getRecord();
    if (
      version !== epoch ||
      revision !== saveRevision ||
      id !== record?.id ||
      !data ||
      focusCacheKey(record.sentences, data.config) !== focusCacheKey(record.sentences, config)
    )
      return;
    cacheBook = {
      sentences: record.sentences,
      focusConfig: config,
      focusCache: data.cache,
      focusCaches: data.focusCaches || record.focusCaches || {},
    };
    if (!force && JSON.stringify(cache) === JSON.stringify(data.cache)) return;
    cache = normalizeFocusCache(record.sentences, config, data.cache);
    recompute(force);
  }
  function save() {
    const next = read(),
      snapshot = getRecord(),
      id = snapshot?.id || recordId,
      version = epoch,
      revision = ++saveRevision,
      platform = snapshot?.videoInfo?.platform,
      remote = isExt && platform !== 'demo';
    if (!snapshot || !recordCurrent(id, version)) return saveQueue;
    cacheBook = {
      sentences: snapshot.sentences,
      focusConfig: config,
      focusCache: cache,
      focusCaches: cacheBook?.focusCaches || {},
    };
    ({ config, cache } = selectFocusConfig(cacheBook, next));
    onOverlayPreference?.();
    const savedCache = cache,
      savedCaches = remote ? null : structuredClone(cacheBook.focusCaches);
    recompute(true);
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        // A queued save belongs to the record and platform captured when the user
        // changed the setting. Never let it write after a video switch or leave.
        if (!recordCurrent(id, version)) return null;
        const data = remote
          ? await rpc('SAVE_FOCUS', { recordId: id, config: next, makeDefault: true })
          : { config: next, cache: savedCache, focusCaches: savedCaches };
        if (!remote) localStorage.setItem('cuemind-focus-demo', JSON.stringify(data));
        if (recordCurrent(id, version) && revision === saveRevision) {
          config = normalizeFocusConfig(data?.config || next);
          cache = normalizeFocusCache(snapshot.sentences, config, data?.cache);
          recompute(true);
          message('偏好已保存 · ' + goalStatus());
        }
      });
    return saveQueue;
  }
  async function analyze() {
    if (focusBusy) return;
    const snapshot = getRecord(),
      id = snapshot?.id || recordId,
      platform = snapshot?.videoInfo?.platform;
    if (!id || !recordCurrent(id, epoch)) return;
    const run = {
      id,
      version: epoch,
      platform,
      time: getTime(),
      remote: isExt && platform !== 'demo',
      cancelled: false,
      dispatched: false,
      timer: null,
    };
    analysisRun = run;
    focusBusy = true;
    updateControls();
    const current = () => analysisRun === run && recordCurrent(run.id, run.version);
    const active = () => current() && !run.cancelled;
    const allowed = () => current() && !run.cancelled;
    try {
      await saveQueue;
      if (!allowed()) return;
      await save();
      if (!allowed() || config.goal === 'off') return;
      if (!run.remote) throw new Error('请在真实视频中配置模型后分析；自定义术语无需 AI。');
      if (!allowed()) return;
      run.timer = setInterval(() => {
        if (active()) refresh().catch(() => {});
      }, 1500);
      pollTimer = run.timer;
      run.dispatched = true;
      if (!allowed()) return;
      const result = await rpc('TASK', {
        recordId: run.id,
        capability: 'focus',
        args: { currentTime: run.time, retry: !!cache?.failed?.length },
      });
      if (!current()) return;
      cache = result?.cache || cache;
      recompute(false);
    } catch (error) {
      if (current() && !run.cancelled && !/取消|abort/i.test(error.message || '')) throw error;
    } finally {
      stopPolling(run);
      if (current()) {
        focusBusy = false;
        let finalError = null;
        try {
          await refresh();
        } catch (error) {
          if (!run.cancelled) finalError = error;
        }
        if (current()) {
          if (run.cancelled) cache = { ...(cache || {}), status: 'cancelled' };
          updateControls();
          if (run.cancelled) message('已取消，完成的重点词已保留。');
          if (pendingOverlayClose) {
            pendingOverlayClose = false;
            try {
              await save();
            } catch (error) {
              if (!run.cancelled) finalError = error;
            }
          }
          if (analysisRun === run) analysisRun = null;
        }
        if (finalError && !run.cancelled) throw finalError;
      }
    }
  }
  async function cancel() {
    const run = analysisRun;
    if (!run || !focusBusy) return;
    run.cancelled = true;
    stopPolling(run);
    message('正在取消，已完成的标注会保留…');
    if (run.dispatched && !run.cancelSent) {
      run.cancelSent = true;
      await rpc('CANCEL', { recordId: run.id, capability: 'focus' }).catch(() => {});
    }
  }
  async function markMastered(term) {
    const selectedTerm = String(term || '').trim();
    if (!selectedTerm || selectedTerm.length > 160) return;
    if (focusBusy) throw new Error('请先取消重点词分析，再修改已掌握词。');
    const snapshot = getRecord(),
      id = snapshot?.id || recordId,
      version = epoch,
      platform = snapshot?.videoInfo?.platform,
      remote = isExt && platform !== 'demo';
    if (!recordCurrent(id, version)) return;
    await saveQueue;
    if (!recordCurrent(id, version) || focusBusy) return;
    const data = remote
      ? await rpc('FOCUS_OVERRIDE', { recordId: id, term: selectedTerm, action: 'mastered' })
      : {
          config: normalizeFocusConfig({ ...config, mastered: [...config.mastered, selectedTerm] }),
          cache,
        };
    if (!recordCurrent(id, version)) return;
    config = normalizeFocusConfig(data.config);
    cache = data.cache;
    if (!remote) localStorage.setItem('cuemind-focus-demo', JSON.stringify(data));
    fill();
    recompute(true);
    toast('已掌握：' + selectedTerm);
  }
  async function leave() {
    const run = analysisRun,
      id = recordId,
      wasBusy = focusBusy;
    if (run) abandonAnalysis(run);
    stopPolling();
    analysisRun = null;
    pendingOverlayClose = false;
    focusBusy = false;
    epoch++;
    recordId = null;
    if (wasBusy && id && run?.dispatched && !run.cancelSent) {
      run.cancelSent = true;
      await rpc('CANCEL', { recordId: id, capability: 'focus' }).catch(() => {});
    }
  }
  entry.onclick = safe(async () => {
    if (!getRecord()?.sentences?.length) throw new Error('请先读取视频字幕');
    await sync();
    fill();
    message(goalStatus());
    dialog.showModal();
  });
  $('#focus-close').onclick = () => dialog.close();
  $('#focus-save').onclick = safe(async () => {
    await save();
    dialog.close();
  });
  $('#focus-analyze').onclick = safe(analyze);
  $('#focus-cancel').onclick = safe(cancel);
  for (const id of [
    'focus-goal',
    'focus-custom',
    'focus-glossary',
    'focus-mastered',
    'focus-overlay',
    'focus-overlay-language',
  ])
    $('#' + id).onchange = safe(save);
  for (const id of ['focus-size', 'focus-video-size', 'focus-video-translation-size']) {
    $('#' + id).oninput = () => {
      config = read();
      updateControls();
      sendOverlay().catch(() => {});
    };
    $('#' + id).onchange = safe(save);
  }
  fill();
  return {
    sync,
    renderText,
    parts,
    sendOverlay,
    markMastered,
    refresh,
    get busy() {
      return focusBusy;
    },
    get wantsTranslation() {
      return config.overlay && config.overlayLanguage !== 'original';
    },
    leave,
    closed: async () => {
      if (!config.overlay) {
        pendingOverlayClose = false;
        return;
      }
      config = { ...config, overlay: false };
      $('#focus-overlay').checked = false;
      updateControls();
      if (focusBusy) {
        pendingOverlayClose = true;
        return;
      }
      pendingOverlayClose = false;
      await save();
    },
  };
}
