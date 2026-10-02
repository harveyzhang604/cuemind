import { audioClips, getAudio, deleteAudio, audioCoverage } from '../storage/audio.js';
import { LocalAudioPlayer } from './local-audio.js';
import {
  transcriptText as formatTranscript,
  answerText,
  searchText as subtitleSearchText,
  literalMatches,
} from './text.js';
import { createFocusUI } from './focus-ui.js';
import { quoteTranslation } from '../core/quote.js';
import { conversationTopics, topicKey, noteSources } from '../core/conversation.js';
import { qaContext } from '../core/retrieval.js';
import { parseSubtitle, formatTime, timestampUrl } from '../core/transcript.js';
import { activeIndex, studyGroups } from '../core/sentence.js';
import { markdown, mindmap, outline, subtitles } from '../core/export.js';
import { demoRecord } from './demo.js';
import { prepareSpeechAudio, speechSettings } from '../services/speech.js';
import { keyFromUrl, matchesVideoUrl } from '../core/video.js';
import { buildAsrTimeline } from '../core/asr-progress.js';
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const ext = !!globalThis.chrome?.runtime?.id;
let followPlayback = true,
  readingId = null,
  openActionsId = null,
  asrOpen = false;
let replayViewAnchor = null,
  replaySelection = null,
  replayEdits = Promise.resolve(),
  replayEditing = 0,
  replayStarting = 0,
  replayArmed = false,
  spaceActions = Promise.resolve(),
  panelArrow = null,
  lastKeyboardState = '';
let availableTracks = [],
  record = null,
  tabId = null,
  loadingVideoKey = null,
  generation = 0,
  mode = 'original',
  studyMode = 'bilingual',
  active = -1,
  time = 0,
  limit = 70,
  listOffset = 0,
  repeat = 1,
  selectedIds = [],
  qaPinnedId = null,
  qaFollowup = null,
  qaTopicId = null,
  qaRecordId = null,
  qaSelectedText = '',
  notes = [],
  chats = [],
  editing = null,
  busy = false,
  backgroundBusy = false,
  smart = false,
  recording = false,
  normalRate = 1,
  lastScroll = 0,
  lastSmartRate = null,
  toastTimer,
  statusTimer,
  settings = {},
  progressVersion = 0,
  captureInfo = null,
  asrElapsedTimer = null;
let localAudioMode = false;
const localPlayer = new LocalAudioPlayer((state) => {
  if (localAudioMode && record) receivePlayerState({ ...state, tabId, localAudio: true });
}, error);
const focus = createFocusUI({
  getRecord: () => record,
  getTime: () => time,
  getTabId: () => tabId,
  rpc,
  isExt: ext,
  onRender: refreshFocusText,
  onError: error,
  onOverlayPreference: () => queueMicrotask(maybeTranslateVideo),
  onClose: () => {
    if (
      followPlayback &&
      active >= 0 &&
      $('#transcript').classList.contains('active') &&
      !getSelection()?.toString()
    )
      locate();
  },
  toast,
});
let automaticTranslationRecordId = null;
async function maybeTranslateVideo() {
  if (localAudioMode) return;
  if (
    !ext ||
    !record?.sentences?.length ||
    record.videoInfo.platform === 'demo' ||
    !tabId ||
    loadingVideoKey ||
    !(focus.wantsTranslation || mode === 'bilingual' || mode === 'translated') ||
    !modelReady() ||
    busy ||
    backgroundBusy ||
    recording ||
    focus.busy ||
    record.id === automaticTranslationRecordId ||
    record.tasks?.translation?.failed?.length ||
    record.sentences.every((s) => s.translation)
  )
    return;
  automaticTranslationRecordId = record.id;
  try {
    await task('translation', { automatic: true });
  } catch (e) {
    if (!e.setup) error(e);
  }
}
const demoNotes = () => {
  try {
    const data = JSON.parse(localStorage.getItem('cuemind-demo-notes') || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};
async function rpc(type, data = {}) {
  if (type === 'PLAYER_COMMAND' && localAudioMode) return localPlayer.command(data.command);
  if (ext && ['TASK', 'TRANSLATE_NOTES'].includes(type) && !modelReady()) {
    requestSetup('text');
    throw Object.assign(new Error('请先配置文本模型'), { setup: true });
  }
  if (ext) {
    const r = await chrome.runtime.sendMessage({ type, ...data });
    if (!r?.ok) throw new Error(r?.error || '扩展服务暂不可用');
    return r.data;
  }
  if (type === 'NOTES') return demoNotes();
  if (type === 'CHATS') return [];
  if (type === 'SAVE_NOTE') {
    const n = { ...data.note, id: data.note.id || crypto.randomUUID(), updatedAt: Date.now() };
    const a = demoNotes().filter((x) => x.id !== n.id);
    a.push(n);
    localStorage.setItem('cuemind-demo-notes', JSON.stringify(a));
    return n;
  }
  if (type === 'DELETE_NOTE') {
    localStorage.setItem(
      'cuemind-demo-notes',
      JSON.stringify(demoNotes().filter((x) => x.id !== data.id)),
    );
    return;
  }
  throw new Error('请在 Chrome 中加载 extension 文件夹使用真实视频和 AI 功能。');
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text, fn, cls = 'text-btn') {
  const b = el('button', cls, text);
  b.onclick = (e) => {
    e.stopPropagation();
    Promise.resolve()
      .then(() => fn(e))
      .catch(error);
  };
  return b;
}
function toast(text, action, label = '撤销') {
  const box = $('#toast');
  box.replaceChildren(el('span', '', text));
  if (action)
    box.append(
      button(label, async () => {
        await action();
        box.hidden = true;
      }),
    );
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), action ? 10000 : 3000);
}
function status(text, isError = false, duration = 0) {
  clearTimeout(statusTimer);
  $('#status').dataset.kind = duration ? 'ad' : '';
  if (duration) statusTimer = setTimeout(() => status(''), duration);
  const replayStatus = $('#replay-status');
  replayStatus.hidden = !text;
  replayStatus.textContent = text;
  if (text && (busy || backgroundBusy))
    replayStatus.append(button('取消任务', () => rpc('CANCEL', { recordId: record?.id })));
  $('#status').hidden = !text;
  $('#status-text').textContent = text;
  $('#status').classList.toggle('error', isError);
}
function error(e) {
  if (e.setup) return;
  const message = e.message || String(e);
  status(message, true, message.startsWith('正在播放广告') ? 3000 : 0);
}
function guard(fn) {
  return (...args) => {
    try {
      return Promise.resolve(fn(...args)).catch(error);
    } catch (e) {
      error(e);
    }
  };
}
function modelReady() {
  if (settings.apiKey?.trim()) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(settings.baseUrl).hostname);
  } catch {
    return false;
  }
}
function openSetup(kind) {
  const hash = kind === 'speech' ? 'speech-service' : 'text-service';
  if (ext) chrome.tabs.create({ url: chrome.runtime.getURL('panel/settings.html') + '#' + hash });
  else location.assign('settings.html#' + hash);
}
function requestSetup(kind) {
  const speech = kind === 'speech';
  $('#setup-needed-close').textContent = speech ? '暂不配置' : '继续看字幕';
  $('#setup-needed-title').textContent = speech ? '配置语音转写' : '配置翻译与问答';
  $('#setup-needed-copy').textContent = speech
    ? '没有原文字幕时才需要语音服务。选择 Groq 或 OpenAI，地址和模型会自动填写；保存后回来继续。'
    : '原文字幕、复听和原文笔记都可以继续使用。翻译、问答和 AI 分析需要先选择文本服务商并填写自己的 API Key。';
  $('#setup-needed-configure').onclick = () => {
    $('#setup-needed').close();
    openSetup(kind);
  };
  if (!$('#setup-needed').open) $('#setup-needed').showModal();
}
$('#setup-needed-close').onclick = () => $('#setup-needed').close();
$('#configure-asr').onclick = () => openSetup('speech');
function requireRecord() {
  if (!record?.sentences.length) throw new Error('请先读取视频字幕，或导入 SRT / VTT。');
  return record;
}
function current() {
  return record?.sentences[
    active >= 0
      ? active
      : Math.max(
          0,
          record.sentences.findLastIndex((s) => s.start <= time),
        )
  ];
}
const viewScroll = {};
let searchIndex = 0,
  searchIds = [],
  readingTimer;
function showTab(id) {
  if (id === 'chat') id = 'study';
  if ($('#replay-dialog').open) $('#replay-dialog').close();
  saveReading();
  if (typeof selectionNote !== 'undefined') {
    selectionNote.hidden = selectionButton.hidden = selectionMastered.hidden = true;
  }
  const previous = $('.view.active')?.id;
  if (previous) viewScroll[previous] = window.scrollY;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  document.body.classList.toggle('qa-active', id === 'study');
  if (id === 'study') renderQaContext();
  window.scrollTo({ top: viewScroll[id] || 0, behavior: 'instant' });
  syncKeyboard();
}
function showSource(sentence) {
  if (!sentence) return;
  showTab('transcript');
  $('#search').value = '';
  const i = record.sentences.indexOf(sentence);
  listOffset = Math.max(0, i - 15);
  limit = 70;
  renderSentences();
  pauseFollow();
  lastScroll = Date.now();
  const node = $$('.sentence').find((n) => n.dataset.id === sentence.id);
  node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  node?.classList.add('source-target');
}
$$('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
async function chooseTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!keyFromUrl(tab?.url))
    throw new Error(
      '请先打开 YouTube、Bilibili 或咪咕赛事播放页，再点击读取视频；咪咕请先点击工具栏上的 CueMind 图标。',
    );
  return tab;
}
async function leaveVideo() {
  const previous = record,
    previousTab = tabId,
    restoreRate = normalRate,
    wasSmart = smart;
  await focus.leave();
  smart = false;
  lastSmartRate = null;
  $('#smart').textContent = '智能速度：关闭';
  if (ext && previous && previous.videoInfo.platform !== 'demo' && previousTab) {
    await rpc('PLAYER_COMMAND', {
      tabId: previousTab,
      command: { action: 'keyboard', videoKey: previous.videoKey, keyboardEnabled: false },
    }).catch(() => {});
    if (busy) await rpc('CANCEL', { recordId: previous.id }).catch(() => {});
    if (wasSmart)
      await rpc('PLAYER_COMMAND', {
        tabId: previousTab,
        command: { action: 'rate', rate: restoreRate, videoKey: previous.videoKey },
      }).catch(() => {});
  }
}
async function load(refresh = false, trackId) {
  saveReading();
  automaticTranslationRecordId = null;
  asrOpen = false;
  const gen = ++generation;
  progressVersion++;
  replaySelection = null;
  replayArmed = false;
  playingRange = null;
  resumeFollow();
  const leaving = leaveVideo();
  localAudioMode = false;
  localPlayer.dispose();
  $('#audio-video-mode').hidden = true;
  busy = false;
  backgroundBusy = false;
  $('#cancel').hidden = true;
  record = null;
  chats = [];
  notes = [];
  tabId = null;
  loadingVideoKey = null;
  active = -1;
  time = 0;
  selectedIds = [];
  qaPinnedId = null;
  qaFollowup = null;
  qaTopicId = null;
  qaSelectedText = '';
  Object.keys(viewScroll).forEach((k) => delete viewScroll[k]);
  $('#question').value = '';
  $('#search').value = '';
  $('#qa-request-state').hidden = true;
  $('#chat-form button[type=submit]').disabled = false;
  $('#chat-form button[type=submit]').textContent = '提问 ↗';
  $$('[data-qa-shortcut]').forEach((b) => (b.disabled = false));
  $('#qa-scope').value = 'sentence';
  listOffset = 0;
  renderTracks([]);
  render();
  status('正在读取当前视频与字幕…');
  try {
    if (!ext) throw new Error('当前是网页预览。可先体验示例，真实视频功能请加载 Chrome 扩展。');
    await leaving;
    const tab = await chooseTab();
    if (gen !== generation) return;
    tabId = tab.id;
    loadingVideoKey = keyFromUrl(tab.url);
    const data = await rpc('LOAD', {
      tabId: tab.id,
      trackId: trackId ?? 'auto',
      refresh,
      videoKey: loadingVideoKey,
    });
    if (gen !== generation) return;
    record = data.record;
    mode = record.videoInfo.platform === 'migu' ? 'bilingual' : 'original';
    limit = 70;
    renderTracks(data.tracks);
    const captured = await rpc('CAPTURE_STATUS');
    if (gen !== generation) return;
    captureInfo = captured;
    recording = !!captured;
    renderCapture();
    if (captured?.tabId === tab.id) {
      record = await rpc('GET_RECORD', { recordId: captured.recordId });
      if (gen !== generation) return;
    }
    if (!(await hydrate(gen))) return;
    await syncTaskState();
    await restoreReading(gen);
    if (!backgroundBusy)
      status(data.needASR ? data.warning || '没有找到可用字幕，可以导入字幕或生成 ASR 字幕。' : '');
    if (['youtube', 'bilibili'].includes(record.videoInfo.platform))
      rpc('SAVE_VIDEO_AUDIO', { recordId: record.id, tabId: tab.id }).catch(() => {});
    await bindPlayer();
    if (data.recovered?.translations || data.recovered?.focus)
      toast(
        `已复用同视频缓存：${data.recovered.translations || 0} 句译文、${data.recovered.focus || 0} 组重点词`,
      );
  } catch (e) {
    if (gen === generation) error(e);
  } finally {
    if (gen === generation) loadingVideoKey = null;
  }
}
function renderTracks(tracks = availableTracks) {
  availableTracks = tracks;
  if (record) {
    const meta = record.transcriptMeta;
    $('#source').title =
      meta.source === 'supadata_native'
        ? '通过 Supadata 获取已有平台字幕，不使用 AI 生成；平台未标明人工或自动来源。'
        : meta.source?.endsWith('_native')
          ? meta.selectedByUser
            ? '使用你手动选择的字幕轨道。'
            : record.videoInfo.audioLanguage
              ? '优先匹配当前音频语言，再优先人工字幕。'
              : '平台未提供音频语言，当前轨道不保证是原始语言；可在字幕设置中选择来源。'
          : '';
  }
  const select = $('#tracks');
  select.replaceChildren();
  for (const t of tracks) {
    const o = el('option', '', t.label + (t.isAi ? ' · 平台自动' : ' · 人工'));
    o.value = t.id;
    o.selected = t.id === record?.transcriptMeta.trackId;
    select.append(o);
  }
  if (record?.videoInfo.platform === 'youtube' && settings.supadataApiKey) {
    const o = el('option', '', 'Supadata · 平台原生字幕');
    o.value = 'supadata';
    o.selected = record.transcriptMeta.source === 'supadata_native';
    select.append(o);
  }
  if (
    record &&
    !tracks.some((t) => t.id === record.transcriptMeta.trackId) &&
    !(record.transcriptMeta.source === 'supadata_native' && settings.supadataApiKey)
  ) {
    const o = el(
      'option',
      '',
      record.transcriptMeta.source === 'supadata_native'
        ? '当前：Supadata 字幕'
        : record.transcriptMeta.source === 'whisper'
          ? '当前：ASR 语音转写'
          : '当前：本地字幕',
    );
    o.value = record.transcriptMeta.trackId || '';
    o.selected = true;
    o.disabled = true;
    select.append(o);
  }
  select.hidden = !select.options.length;
}
async function hydrate(gen = generation) {
  const id = record?.id,
    scope = $('#note-scope').value,
    isDemo = record?.videoInfo.platform === 'demo';
  const [newNotes, newChats] = isDemo
    ? [demoNotes(), []]
    : await Promise.all([
        rpc('NOTES', { recordId: scope === 'all' ? undefined : id }),
        rpc('CHATS', { recordId: id }),
      ]);
  if (gen !== generation || id !== record?.id || scope !== $('#note-scope').value) return false;
  notes = newNotes;
  chats = newChats;
  render();
  return true;
}
function render() {
  applyTranslationDisplay();
  focus.sync().catch(error);
  if (qaRecordId !== record?.id) {
    qaRecordId = record?.id;
    readingId = null;
    openActionsId = null;
    qaTopicId = null;
    qaFollowup = null;
    qaPinnedId = null;
    qaSelectedText = '';
    selectedIds = [];
    $('#question').value = '';
    $('#qa-scope').value = 'sentence';
  }
  renderTracks();
  if (record) {
    $('#video-title').textContent = record.videoInfo.title;
    $('#video-title').title = record.videoInfo.title;
    $('#platform').textContent =
      record.videoInfo.platform === 'demo'
        ? 'CUEMIND / 示例体验'
        : `${record.videoInfo.platform.toUpperCase()} / VIDEO NOTES`;
    $('#source').textContent =
      record.transcriptMeta.source === 'demo'
        ? '原创示例 · 非真实视频'
        : record.transcriptMeta.source?.includes('whisper')
          ? 'ASR 语音转写'
          : record.transcriptMeta.source === 'import'
            ? '导入字幕'
            : record.transcriptMeta.source === 'supadata_native'
              ? `Supadata 字幕 · ${record.transcriptMeta.language || '原文'}`
              : record.transcriptMeta.source === 'migu_audio'
                ? '咪咕音频 · 尚未生成字幕'
                : record.transcriptMeta.source === 'bilibili_audio'
                  ? 'B站中文字幕与英语原声不符 · 等待音频识别'
                  : `${record.transcriptMeta.isAi ? '平台自动字幕' : '平台人工字幕'}${record.transcriptMeta.language ? ' · ' + record.transcriptMeta.language : ''}`;
    $('#video-meta').textContent =
      `${record.videoInfo.author || '视频'} · ${formatTime(record.videoInfo.duration)}${record.videoInfo.platform === 'bilibili' && record.videoInfo.page > 1 ? ` · P${record.videoInfo.page}` : ''}`;
  } else {
    $('#video-title').textContent = '把看过，变成学会。';
    $('#platform').textContent = 'YOUR VIDEO, UNDERSTOOD';
    $('#source').textContent = '本地优先';
    $('#video-meta').textContent = '完整句阅读 · 精准复听 · 有依据的问答';
    $('#play-time').textContent = '00:00';
    $('#play-state').textContent = '准备开始';
  }
  for (const id of [
    'previous',
    'next',
    'replay',
    'loop',
    'subtitle-settings',
    'export',
    'first-subtitle',
  ])
    $('#' + id).disabled = !record?.sentences.length;
  $('#empty').hidden = !!record?.sentences.length;
  $('#asr-box').hidden = !record || (!!record.sentences.length && !asrOpen);
  $('#sentence-count').textContent = record
    ? `${record.sentences.length} 个完整句 · ${record.paragraphs.length} 个复听段`
    : '还没有学习材料';
  renderSentences();
  renderStudy();
  renderQaContext();
  renderOverview();
  renderChats();
  renderNotes();
  renderCapture();
  updateReplayScope();
  if (!record) $('#stop').hidden = true;
}
function renderSentences() {
  const container = $('#sentences');
  container.replaceChildren();
  $('#more').hidden = true;
  $('#open-replay').disabled = !record?.sentences?.length;
  if (!record) {
    updateSearchControls([]);
    return;
  }
  const q = $('#search').value.toLowerCase().trim(),
    raw = mode === 'raw';
  const list = (raw ? record.rawCaptions : record.sentences).filter((s) =>
    searchText(s).toLowerCase().includes(q),
  );
  if (listOffset >= list.length) listOffset = 0;

  const indices = new Map(record.sentences.map((s, i) => [s.id, i]));
  const levels = new Map((record.studyMap || []).map((r) => [r.fromSentenceId, r.level]));
  if (!list.slice(listOffset, listOffset + limit).some((s) => s.id === openActionsId))
    openActionsId = null;
  for (const s of list.slice(listOffset, listOffset + limit)) {
    const parent = raw ? record.sentences.find((x) => x.sourceIds.includes(s.id)) : s,
      index = indices.get(parent?.id);
    const card = el('article', 'sentence' + (index === active ? ' active' : ''));
    card.dataset.id = parent?.id || s.id;
    card.dataset.actionsId = s.id;
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${formatTime(s.start)} ${s.rawText || s.text}`);
    const select = (event) => {
      if (event?.target?.closest('button') || getSelection()?.toString()) return;
      selectReplaySentence(parent);
      readingId = parent?.id || s.id;
      pauseFollow();
      $$('.sentence').forEach((n) => n.classList.toggle('reading', n.dataset.id === readingId));
    };
    card.classList.toggle('reading', card.dataset.id === readingId);
    const activate = (event) => {
      if (event?.target?.closest('button') || getSelection()?.toString()) return;
      select(event);
      seekPlay(s.start).catch(error);
    };
    card.onclick = activate;
    card.onkeydown = (e) => {
      if (e.target === card && e.key === 'Enter') {
        e.preventDefault();
        activate(e);
      }
      if (e.key === 'Escape' && card.classList.contains('actions-open')) {
        e.preventDefault();
        e.stopPropagation();
        setSentenceActions(null);
        card.querySelector('.sentence-toggle').focus();
      }
    };
    const timestamp = button(
      formatTime(s.start),
      () => {
        selectReplaySentence(parent);
        return seekPlay(s.start);
      },
      'timestamp',
    );
    timestamp.title = s.estimatedTiming
      ? '原字幕只提供整段时间，句内时间为估算值；点击从这里播放'
      : '从这里播放';
    timestamp.setAttribute(
      'aria-label',
      formatTime(s.start) + (s.estimatedTiming ? ' 估算时间' : '') + ' 从这里播放',
    );
    card.append(timestamp);
    const body = el('div', 'sentence-body');
    const original = el('div', mode === 'translated' ? 'caption-translated' : 'caption-original');
    if (mode === 'translated') original.textContent = s.translation || '尚未翻译 · ' + s.rawText;
    else original.append(focus.renderText(parent || s));
    body.append(original);
    if (mode === 'bilingual' && s.translation) body.append(el('div', 'translation', s.translation));
    const actions = el('div', 'sentence-actions');
    actions.id = `sentence-actions-${generation}-${mode}-${s.id}`;
    actions.append(
      button('↺ 复听', () => {
        selectReplaySentence(parent);
        resumeFollow();
        return playRange(s, repeat);
      }),
      button('提问', () => ask(parent)),
      button('＋ 笔记', () => editNote(parent)),
    );
    const level = levels.get(parent?.id) || 'unrated',
      label = { repeat: '重点复听', normal: '正常听', skim: '可略过' }[level] || '未标记';
    const toggle = button(
      '',
      () => {
        const next = openActionsId === s.id ? null : s.id;
        if (next) pauseFollow();
        setSentenceActions(next);
        if (next) {
          const bottom = actions.getBoundingClientRect().bottom,
            boundary = $('footer').getBoundingClientRect().top - 8;
          if (bottom > boundary) window.scrollBy({ top: bottom - boundary, behavior: 'instant' });
        }
      },
      'sentence-toggle',
    );
    toggle.dataset.level = level;
    toggle.dataset.levelLabel = label;
    toggle.setAttribute('aria-controls', actions.id);
    const opened = openActionsId === s.id;
    card.classList.toggle('actions-open', opened);
    toggle.setAttribute('aria-expanded', String(opened));
    toggle.setAttribute('aria-label', `${label} · ${opened ? '收起' : '展开'}本句操作`);
    toggle.title = toggle.getAttribute('aria-label');
    card.append(toggle);
    card.append(body, actions);
    container.append(card);
  }
  $('#more').hidden = true;
  updateReplayScope();
  container.dataset.hasBefore = String(listOffset > 0);
  container.dataset.hasAfter = String(list.length > listOffset + limit);
  updateTranslationPrompt();
  updateLocateControl();
  updateSearchControls(list);
  if (q && !list.length) container.append(el('div', 'placeholder', '没有匹配的字幕。'));
}
function setSentenceActions(id) {
  openActionsId = id;
  for (const card of $$('#sentences .sentence')) {
    const opened = card.dataset.actionsId === id,
      toggle = card.querySelector('.sentence-toggle');
    card.classList.toggle('actions-open', opened);
    toggle.setAttribute('aria-expanded', String(opened));
    toggle.setAttribute(
      'aria-label',
      `${toggle.dataset.levelLabel} · ${opened ? '收起' : '展开'}本句操作`,
    );
    toggle.title = toggle.getAttribute('aria-label');
  }
}
function refreshFocusText(force = false) {
  if (!record || $('#search').value || (!force && (getSelection()?.toString() || !followPlayback)))
    return;
  const byId = new Map(record.sentences.map((s) => [s.id, s]));
  for (const row of $$('#sentences .sentence')) {
    const original = row.querySelector('.caption-original'),
      s = byId.get(row.dataset.id);
    if (original && s) {
      const text = focus.renderText(s);
      if (original.textContent === s.rawText && original.innerHTML === fragmentHTML(text)) continue;
      original.replaceChildren(text);
    }
  }
}
function fragmentHTML(fragment) {
  const holder = document.createElement('div');
  holder.append(fragment.cloneNode(true));
  return holder.innerHTML;
}
function pageSentences(offset) {
  pauseFollow();
  limit = 70;
  listOffset = offset;
  lastScroll = Date.now();
  renderSentences();
  $('#sentences').scrollIntoView({ block: 'start', behavior: 'instant' });
}
function highlight() {
  const id = record?.sentences[active]?.id;
  $$('.sentence,.study-sentence').forEach((e) => {
    const selected = e.dataset.id === id;
    e.classList.toggle('active', selected);
    if (e.classList.contains('study-sentence')) {
      if (selected) e.setAttribute('aria-current', 'true');
      else e.removeAttribute('aria-current');
    }
  });
}
let locateRevision = 0;
function locate({ paged = false } = {}) {
  if (!current() || $('#search').value) return;
  const revision = ++locateRevision,
    gen = generation,
    id = current().id;
  const i =
    mode === 'raw'
      ? record.rawCaptions.findIndex((r) => r.id === current().sourceIds[0])
      : record.sentences.indexOf(current());
  if (i < listOffset || i >= listOffset + limit) {
    listOffset = Math.max(0, i - 15);
    limit = 70;
    renderSentences();
  }
  const align = () => {
    if (
      revision !== locateRevision ||
      gen !== generation ||
      current()?.id !== id ||
      !followPlayback ||
      $('#search').value ||
      !$('#transcript').classList.contains('active') ||
      $$('dialog[open]').length ||
      getSelection()?.toString()
    )
      return;
    const node = $$('#sentences .sentence').find((e) => e.dataset.id === id);
    if (!node) return;
    const box = node.getBoundingClientRect(),
      top = $('.tabs').getBoundingClientRect().bottom,
      bottom = $('footer').getBoundingClientRect().top;
    if (paged) {
      // Keep the page still while the spoken sentence remains readable. Advance
      // a page near the footer, or return to the top when a replay loops back.
      const inset = 12,
        clearance = Math.min(24, Math.max(8, (bottom - top) / 10));
      const bounds = replaySelection && replayBounds(),
        rows = $$('#sentences .sentence');
      const first =
        bounds &&
        rows
          .find((e) => e.dataset.id === record.sentences[bounds.from].id)
          ?.getBoundingClientRect();
      const last =
        bounds &&
        rows.find((e) => e.dataset.id === record.sentences[bounds.to].id)?.getBoundingClientRect();
      if (first && last && first.top >= top + 4 && last.bottom <= bottom - 4) return;
      if (box.top >= top + 4 && box.bottom <= bottom - clearance) return;
      window.scrollBy({ top: box.top - (top + inset), behavior: 'instant' });
    } else
      window.scrollBy({
        top: box.top - (top + Math.max(8, (bottom - top - box.height) / 2)),
        behavior: 'instant',
      });
  };
  align();
  // Recheck after layout/scroll anchoring settles; a new browsing gesture cancels it.
  requestAnimationFrame(() => requestAnimationFrame(align));
}
function scrollStudySentence(node, force = false) {
  const list = $('#study-list'),
    parent = list.getBoundingClientRect(),
    box = node.getBoundingClientRect();
  if (force || box.top < parent.top + 4 || box.bottom > parent.bottom - 4) {
    $$('.study-tooltip').forEach((e) => (e.hidden = true));
    list.scrollTop += box.top - parent.top - Math.max(4, (list.clientHeight - box.height) / 2);
  }
}
let studyFitFrame;
function scheduleStudyFit() {
  cancelAnimationFrame(studyFitFrame);
  studyFitFrame = requestAnimationFrame(() => {
    const selected = $('.study-sentence.selected');
    if ($('#replay-dialog').open && selected) scrollStudySentence(selected);
  });
}
window.addEventListener('resize', scheduleStudyFit);
new ResizeObserver(() => {
  document.documentElement.style.setProperty(
    '--player-height',
    $('footer').getBoundingClientRect().height + 'px',
  );
  scheduleStudyFit();
}).observe($('footer'));
function locateStudy(force = false) {
  const node = $$('.study-sentence').find((e) => e.dataset.id === current()?.id);
  if (node) scrollStudySentence(node, force);
}
async function seekStudy(target) {
  const gen = generation,
    id = record?.id;
  await seekPlay(target);
  if (gen !== generation || id !== record?.id) return;
  time = target;
  active = activeIndex(record.sentences, target);
  if (active < 0)
    active = Math.max(
      0,
      record.sentences.findLastIndex((s) => s.start <= target),
    );
  highlight();
  if ($('#transcript').classList.contains('active') && $('#replay-dialog').open) locateStudy(true);
}
async function seekPlay(start) {
  requireRecord();
  if (record.videoInfo.platform === 'demo') return playRange({ start, end: start + 1 });
  await rpc('PLAYER_COMMAND', {
    tabId,
    command: { action: 'seek', time: start, videoKey: record.videoKey },
  });
  await rpc('PLAYER_COMMAND', { tabId, command: { action: 'play', videoKey: record.videoKey } });
}
function transcriptText() {
  return formatTranscript(requireRecord(), mode);
}
async function playRange(range, count = 1) {
  requireRecord();
  if (recording && captureInfo?.tabId === tabId)
    throw new Error('请先结束音频识别，再跳转或复听。');
  if (!range) throw new Error('请先选择一句字幕。');
  if (record.videoInfo.platform === 'demo') {
    time = range.start ?? range.ranges?.[0]?.start ?? 0;
    active = activeIndex(record.sentences, time);
    $('#play-time').textContent = formatTime(time);
    highlight();
    renderQaContext();
    toast('示例展示跳转状态；真实复听请在视频页面使用。');
    return;
  }
  await rpc('PLAYER_COMMAND', {
    tabId,
    command: {
      ...range,
      action: 'range',
      videoKey: record.videoKey,
      repeat: count,
      pre: range.strict ? 0 : Number(settings.preBuffer ?? 0.15),
      post: range.strict ? 0 : Number(settings.postBuffer ?? 0.15),
    },
  });
  $('#stop').hidden = false;
}
let lastPlayerTick = 0,
  playerSyncPending = false,
  playerStateRevision = 0,
  playbackIdentity = null,
  lastContentPaused = null,
  playingRange = null;
function receivePlayerState(m) {
  if (localAudioMode && !m.localAudio) return;
  if (m.tabId !== tabId || m.videoKey !== record?.videoKey) return;
  if (m.unavailable && record?.videoInfo.platform === 'migu') {
    $('#play-state').textContent = '播放器重新加载中';
    if (active !== -1) {
      active = -1;
      highlight();
    }
    return;
  }
  if (!Number.isFinite(m.time)) return;
  playerStateRevision++;
  lastPlayerTick = Date.now();
  // Ads use the same video element but have their own timeline.
  // Keep the last content position and question context until content resumes.
  if (m.focusCaptionsClosed && m.focusCaptionsVideoKey === record?.videoKey)
    focus.closed().catch(error);
  if (!m.isAd && $('#status').dataset.kind === 'ad') status('');
  if (m.isAd) {
    $('#play-state').textContent = '广告播放中';
    $('#stop').hidden = true;
    updateReplayScope();
    return;
  }
  playingRange =
    m.session && Number.isFinite(m.rangeStart) && Number.isFinite(m.rangeEnd)
      ? { start: m.rangeStart, end: m.rangeEnd }
      : null;
  const identity = JSON.stringify([generation, tabId, record.id, record.videoKey]);
  if (playbackIdentity !== identity) {
    playbackIdentity = identity;
    lastContentPaused = null;
  }
  // A side panel can open after an already-playing video. Its first snapshot
  // has no preceding pause/play event, so restore following from that state.
  const resumed =
    m.paused === false &&
    (lastContentPaused === null || lastContentPaused === true || m.playbackEvent === 'play');
  // A user can seek while paused or after browsing the transcript. A seek is
  // an explicit request to follow the new playhead, even without a play event.
  const sought = m.playbackEvent === 'seeked';
  if (typeof m.paused === 'boolean') lastContentPaused = m.paused;
  if (resumed || sought) resumeFollow();
  if (m.paused === false && !m.session && !replayEditing && !replayStarting) {
    replayViewAnchor = null;
    replaySelection = null;
    replayArmed = false;
  }

  $('#stop').hidden = !m.session && !smart;
  time = m.time;
  updateCaptureEndState(m.duration);
  maybeTranslateVideo();
  const marker = $('.timeline-marker');
  if (marker)
    marker.style.left = `${Math.max(0, Math.min(100, (time / (record.videoInfo.duration || m.duration)) * 100))}%`;
  $('#play-time').textContent = formatTime(time);
  $('#play-state').textContent = m.session ? '正在复听' : m.paused ? '已暂停' : '正在播放';
  if ([1, 3, -1].includes(m.repeat)) {
    repeat = m.repeat;
    $('#loop').textContent = repeat === -1 ? '循环' : `听 ${repeat} 次`;
  }
  // A replay range identifies the exercise, not the sentence being spoken.
  // Multi-sentence replays and the video overlay must use the same live clock.
  const next = activeIndex(record.sentences, time),
    changed = next !== active;
  if (changed) {
    active = next;
    refreshFocusText();
    highlight();
    renderQaContext();
  }
  updateReplayScope();
  // Resuming within the same sentence must also restore its reading position.
  if (
    (changed || resumed || sought) &&
    next >= 0 &&
    followPlayback &&
    !getSelection()?.toString() &&
    $('#transcript').classList.contains('active') &&
    !$('#search').value &&
    !$$('dialog[open]').length
  )
    locate({ paged: true });
  if (!smart && !m.isAd) normalRate = m.rate;
  else if (smart && !m.isAd) {
    const sentence = record.sentences[next];
    const r = record.studyMap?.find((x) => x.fromSentenceId === sentence?.id);
    const rate =
      r?.level === 'repeat' ? 1 : r?.level === 'skim' ? Math.max(1.75, normalRate) : normalRate;
    if (rate !== lastSmartRate) {
      lastSmartRate = rate;
      rpc('PLAYER_COMMAND', {
        tabId,
        command: { action: 'rate', rate, videoKey: record.videoKey },
      }).catch(error);
    }
  }
}
async function syncPlayerState() {
  if (!ext || !record || record.videoInfo.platform === 'demo' || playerSyncPending) return;
  const gen = generation,
    id = tabId,
    revision = playerStateRevision;
  playerSyncPending = true;
  try {
    await syncTaskState();
    const state = await rpc('PLAYER_COMMAND', {
      tabId: id,
      command: { action: 'state', videoKey: record.videoKey, ...keyboardConfig() },
    });
    if (gen === generation && id === tabId && revision === playerStateRevision)
      receivePlayerState({ ...state, tabId: id, localAudio: localAudioMode });
  } catch (e) {
    if (gen === generation) $('#play-state').textContent = '播放器连接中…';
  } finally {
    playerSyncPending = false;
  }
}
async function syncTaskState() {
  if (!ext || !record || busy) return;
  const id = record.id,
    gen = generation;
  const running = await rpc('TASK_STATUS', { recordId: id }).catch(() => null);
  if (!Array.isArray(running) || gen !== generation || record?.id !== id || busy) return;
  const wasBusy = backgroundBusy;
  backgroundBusy = running.length > 0;
  if (backgroundBusy) {
    $('#cancel').hidden = false;
    status(
      running.some((task) => task.canceling)
        ? '正在取消后台任务，已完成的内容会保留。'
        : '后台任务仍在处理；完成后可重试缺失内容，也可点击“取消任务”。',
    );
  } else if (wasBusy) {
    $('#cancel').hidden = true;
    const saved = await rpc('GET_RECORD', { recordId: id });
    if (gen !== generation || record?.id !== id || busy) return;
    record = saved;
    render();
    status('后台任务已结束，已更新本机结果。');
  }
  updateTranslationPrompt();
  if (wasBusy !== backgroundBusy) renderCapture();
}
setInterval(syncPlayerState, 2000);
async function bindPlayer(refreshOverlay = false) {
  if (!ext || !record || record.videoInfo.platform === 'demo') return;
  await rpc('PLAYER_COMMAND', {
    tabId,
    command: {
      action: 'bind',
      videoKey: record.videoKey,
      ...keyboardConfig(),
      sentences: record.sentences.map(({ id, start, end }) => ({ id, start, end })),
      paragraphs: record.paragraphs,
      repeat,
      pre: settings.preBuffer,
      post: settings.postBuffer,
    },
  });
  await syncPlayerState();
  await focus.sendOverlay(refreshOverlay);
}
async function task(capability, args = {}) {
  requireRecord();
  if (ext && !modelReady()) {
    requestSetup('text');
    throw Object.assign(new Error('请先配置文本模型'), { setup: true });
  }
  if (record.videoInfo.platform === 'demo')
    throw new Error('示例仅用于体验阅读与笔记。请在真实视频中配置模型后运行 AI。');
  await syncTaskState();
  if (busy || backgroundBusy || captureInfo?.recordId === record.id)
    throw new Error('当前任务尚未完成，可先取消。');
  busy = true;
  updateTranslationPrompt();
  renderCapture();
  renderQaContext();
  $('#cancel').hidden = false;
  status(args.automatic ? '正在翻译整部视频，先处理当前播放位置…' : '正在连接模型…');
  const gen = generation,
    id = record.id;
  try {
    const result = await rpc('TASK', {
      recordId: id,
      capability,
      args: { currentTime: time, ...args },
    });
    if (gen !== generation || record?.id !== id) return null;
    progressVersion++;
    if (result.record) {
      record = result.record;
      render();
      await bindPlayer();
      if (capability === 'translation') await focus.sendOverlay(true);
    }
    const reasons = [...new Set((result.errors || []).map((x) => x.error))];
    if (result.partial)
      status(
        `${result.errors.length} 批未完成：${reasons.slice(0, 2).join('；')}${reasons.length > 2 ? '；另有其他错误' : ''}${capability === 'translation' ? ' 点击“补齐未完成译文”可只重试缺失的译文。' : ' 再次点击原按钮可重试。'}`,
        true,
      );
    else {
      status('');
      toast('已完成');
    }
    return result;
  } catch (e) {
    if (gen !== generation || record?.id !== id) return null;
    const saved = await rpc('GET_RECORD', { recordId: id }).catch(() => null);
    if (gen !== generation) return null;
    if (saved) {
      record = saved;
      render();
    }
    throw e;
  } finally {
    if (gen === generation) {
      busy = false;
      updateTranslationPrompt();
      renderCapture();
      progressVersion++;
      $('#cancel').hidden = true;
      $('#replay-status button')?.remove();
      renderQaContext();
    }
  }
}
function qaSentence() {
  return record?.sentences.find((s) => s.id === qaPinnedId) || current() || record?.sentences[0];
}

const qaShortcutSets = {
  sentence: [
    ['解释当前句', '这句话什么意思？'],
    ['为什么这样说', '这句话为什么这样表达？'],
    ['重点词', '这里有哪些重点词？'],
    ['简单英语解释', '请用简单英语解释这句话。'],
    ['为什么听不出来', '根据字幕推测，这句话为什么可能听不出来？请说明你没有分析实际音频。'],
  ],
  segment: [
    ['梳理逻辑', '这一片段的论证或步骤是什么？'],
    ['举例说明', '结合当前片段举例说明；原创例子放在补充说明。'],
    ['解释难点', '这一片段有哪些容易误解的地方？'],
  ],
  video: [
    ['核心观点', '整个视频的核心观点是什么？'],
    ['具体方法', '视频给出了哪些具体方法或步骤？'],
    ['有什么局限', '这些观点有哪些适用条件或局限？区分视频依据和补充分析。'],
  ],
};
function renderQaShortcuts(scope, sentence) {
  const root = $('#qa-shortcuts');
  root.replaceChildren();
  const items = qaShortcutSets[scope] || qaShortcutSets.sentence;
  const more = el('details');
  more.id = 'qa-more-shortcuts';
  more.append(el('summary', '', '更多'));
  for (const [i, [label, prompt]] of items.entries()) {
    if (scope === 'sentence' && i > 1 && !/[a-z]{2}/i.test(sentence?.rawText || '')) continue;
    const b = button(label, () => {
      if (busy || !record?.sentences?.length) return;
      resetQaFollowup();
      if (scope !== 'video') qaPinnedId = qaSentence()?.id || null;
      renderQaContext();
      $('#question').value = prompt;
      $('#question').focus();
    });
    b.dataset.qaShortcut = prompt;
    b.disabled = busy;
    (i > 2 ? more : root).append(b);
  }
  if (more.children.length > 1) root.append(more);
}
function savedAnswerNote(c) {
  const key = JSON.stringify([c.topicId, c.question, answerText(c)]);
  return notes.find((n) => n.recordId === record?.id && n.answerKey === key);
}
const savingAnswers = new Set();
async function saveAnswerNote(c) {
  requireRecord();
  const existing = savedAnswerNote(c);
  if (existing) return editNote(null, existing);
  const recordId = record.id,
    key = JSON.stringify([c.topicId, c.question, answerText(c)]);
  if (savingAnswers.has(key)) return;
  savingAnswers.add(key);
  const ids = new Set((c.citations || []).map((r) => r.sentenceId));
  const sources = record.sentences.filter((s) => ids.has(s.id));
  const note = {
    recordId,
    videoKey: record.videoKey,
    videoInfo: record.videoInfo,
    platform: record.videoInfo.platform,
    videoId: record.videoInfo.videoId,
    page: record.videoInfo.page,
    timestamp: sources[0]?.start ?? c.context?.currentTime ?? time,
    end: sources[0]?.end,
    sentenceIds: sources.map((s) => s.id),
    sourceText: sources.map((s) => s.rawText).join('\n'),
    body: answerText(c),
    answerKey: key,
    question: c.question,
    context: c.context,
  };
  try {
    const saved = await noteRpc('SAVE_NOTE', { note });
    if (recordId === record?.id || $('#note-scope').value === 'all') {
      notes = [saved, ...notes.filter((n) => n.id !== saved.id)];
      renderNotes();
      renderChats();
    }
    toast('笔记已保存', () => editNote(null, saved), '补充想法');
  } finally {
    savingAnswers.delete(key);
  }
}
function renderQaContext() {
  const card = $('#qa-current'),
    sentence = qaSentence(),
    scope = $('#qa-scope').value;
  $('#qa-followup').hidden = !qaFollowup;
  $('#qa-followup').textContent = qaFollowup
    ? '接着问：' + qaFollowup.question + ' · 结束追问 ×'
    : '';
  $('#study').classList.toggle('has-conversation', !!qaTopicId);
  card.replaceChildren();
  card.hidden = !sentence || scope === 'video';
  $('#qa-shortcuts').hidden = !!qaTopicId || !sentence;
  renderQaShortcuts(scope, sentence);
  $('#qa-new').disabled = busy;
  $('#qa-scope').disabled = busy;
  $('#qa-language').disabled = busy;
  if (!sentence) {
    $('#chat-context').textContent = '先读取视频字幕';
    return;
  }
  const context =
    scope === 'segment'
      ? qaContext(record.sentences, {
          scope,
          selectedIds: selectedIds.length ? selectedIds : [sentence.id],
          paragraphs: record.paragraphs,
        })
      : [];
  $('#chat-context').textContent =
    scope === 'video'
      ? '检索全片字幕'
      : scope === 'segment' && context.length
        ? `${formatTime(context[0].start)}–${formatTime(context.at(-1).end)}`
        : `${qaPinnedId ? '正在讨论' : '当前播放'} · ${formatTime(sentence.start)}`;
  if (card.hidden) return;
  card.append(
    el(
      'span',
      'qa-current-label',
      qaSelectedText
        ? '选中内容：' + qaSelectedText
        : scope === 'segment'
          ? '正在讨论片段'
          : `${qaPinnedId ? '正在讨论' : '当前播放'} · ${formatTime(sentence.start)}`,
    ),
    el('blockquote', '', sentence.rawText),
  );
  const row = el('div', 'row');
  row.append(
    button(`▶ ${formatTime(sentence.start)} 回听`, () => playRange(sentence, 1)),
    button('查看字幕', () => showSource(sentence)),
  );
  if (qaPinnedId)
    row.append(
      button('使用当前播放句', () => {
        if (busy) return;
        const playing = current();
        qaFollowup = null;
        qaTopicId = null;
        qaSelectedText = '';
        qaPinnedId = playing?.id || null;
        selectedIds = playing ? [playing.id] : [];
        $('#question').value = '';
        renderChats();
      }),
    );
  card.append(row);
}
function newQuestion() {
  if (busy) return;
  qaFollowup = null;
  qaTopicId = null;
  qaSelectedText = '';
  qaPinnedId = null;
  selectedIds = [];
  $('#question').value = '';
  $('#qa-request-state').hidden = true;
  $('#qa-scope').value = 'sentence';
  renderChats();
  renderQaContext();
}
function resumeTopic(c) {
  if (busy) return;
  qaFollowup = c;
  qaTopicId = topicKey(c, chats.indexOf(c));
  const context = c.context || {
    scope: 'sentence',
    selectedIds: (c.citations || []).map((r) => r.sentenceId),
  };
  $('#qa-scope').value = context.scope || 'video';
  $('#qa-language').value = context.answerLanguage || 'zh';
  selectedIds = context.selectedIds || [];
  qaPinnedId = selectedIds[0] || null;
  qaSelectedText = context.selectedText || '';
  $('#question').value = '';
  $('#qa-topics').open = false;
  renderChats();
  renderQaContext();
  $('#question').focus();
  $('#chat-form').scrollIntoView({ block: 'nearest' });
}
function ask(s) {
  requireRecord();
  if (busy) throw new Error('请等待当前回答完成。');
  if (!s) throw new Error('请先选择一句字幕');
  newQuestion();
  if (s.fromSentenceId && s.toSentenceId) {
    const a = record.sentences.findIndex((x) => x.id === s.fromSentenceId),
      b = record.sentences.findIndex((x) => x.id === s.toSentenceId);
    selectedIds = a >= 0 && b >= a ? record.sentences.slice(a, b + 1).map((x) => x.id) : [];
  } else selectedIds = s.sentenceIds || [s.id || s.sentenceId].filter(Boolean);
  qaPinnedId = selectedIds[0] || null;
  $('#qa-scope').value = selectedIds.length > 1 ? 'segment' : 'sentence';
  showTab('study');
  renderChats();
  $('#question').focus();
}
async function explain(s) {
  const selection = getSelection()?.toString().trim();
  ask(s);
  const result = await task('explain', {
    selectedText: selection || s.rawText || s.text,
    question: `解释：${selection || s.rawText || s.text}`,
    selectedIds,
  });
  if (result) {
    const chat = { question: `解释：${selection || s.rawText || s.text}`, ...result };
    chats.push(chat);
    resumeTopic(chat);
  }
}
let studySelection = { recordId: null, chapter: 0, sentenceId: null };
function renderStudy(keepTimeline = false) {
  renderChats();
  const summary = $('#study-summary');
  summary.replaceChildren();
  summary.hidden = true;
  const timeline = $('#study-timeline'),
    list = $('#study-list');
  if (!keepTimeline) timeline.replaceChildren();
  list.replaceChildren();
  $$('.chapter-detail').forEach((e) => e.remove());
  const groups = studyGroups(record?.studyMap || []),
    sentences = new Map((record?.sentences || []).map((s) => [s.id, s]));
  if (!record?.sentences?.length) return;
  const duration = Number(record.videoInfo.duration) || record.sentences.at(-1)?.end || 0;
  const chapters = record.analysis?.chapters || [];
  $('#highlights').disabled =
    !chapters.length || !record.studyMap?.some((r) => r.level === 'repeat');
  $('#study-mode').hidden = !chapters.length;
  $('#replay-dialog .legend').hidden = !chapters.length;
  if (!chapters.length) {
    timeline.replaceChildren();
    list.append(
      el('p', 'replay-empty', '还没有章节地图。生成概览后，就能按章节定位和复听。'),
      button('生成章节概览', () => task('analysis'), 'button'),
    );
    return;
  }
  const initialize =
    studySelection.recordId !== record.id || studySelection.chapter >= chapters.length;
  const chapterRange = (i) => ({
    start: chapters[i].start,
    end: chapters[i + 1]?.start ?? duration,
  });
  const chapterSentences = (i) =>
    record.sentences.filter(
      (s) => s.start >= chapterRange(i).start && s.start < chapterRange(i).end,
    );
  // Initialize at playback once; deliberate chapter selections remain chapters.
  if (initialize) {
    const cursor =
      record.sentences[active] ||
      record.sentences.find((s) => s.start <= time && s.end > time) ||
      record.sentences[0];
    const chapter = Math.max(
      0,
      chapters.findIndex(
        (c, i) =>
          cursor && cursor.start >= chapterRange(i).start && cursor.start < chapterRange(i).end,
      ),
    );
    const first = chapterSentences(chapter)[0];
    studySelection = { recordId: record.id, chapter, sentenceId: cursor?.id || first?.id || null };
  }
  const selected = chapters[studySelection.chapter],
    range = chapterRange(studySelection.chapter);
  const choose = (i, sentenceId = null) => {
    if (studySelection.chapter === i && studySelection.sentenceId === sentenceId) return;
    studySelection = { recordId: record.id, chapter: i, sentenceId };
    renderStudy(true);
    timeline
      .querySelectorAll('.chapter-overview')
      .forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    timeline
      .querySelectorAll('.chapter-part')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === sentenceId)));
    timeline.querySelectorAll('.chapter-part').forEach((b) => {
      b.tabIndex = b.dataset.id === sentenceId ? 0 : -1;
    });
    if (!sentenceId) {
      const first = timeline.children[i]?.querySelector('.chapter-part');
      if (first) first.tabIndex = 0;
    }
    const node = [...list.querySelectorAll('.study-sentence')].find(
      (e) => e.dataset.id === sentenceId,
    );
    if (node) {
      node.classList.add('selected');
      node.setAttribute('aria-current', 'true');
      scrollStudySentence(node, true);
    } else list.scrollTop = 0;
  };
  if (!keepTimeline) {
    timeline.classList.add('chapter-timeline');
    timeline.onmouseleave = () => {
      if (
        timeline.contains(document.activeElement) &&
        document.activeElement.matches(':focus-visible')
      )
        return;
      timeline.querySelectorAll('.chapter-block').forEach((e) => e.classList.remove('expanded'));
    };
    const levelMap = new Map((record.studyMap || []).map((r) => [r.fromSentenceId, r.level]));
    chapters.forEach((c, i) => {
      const r = chapterRange(i),
        items = chapterSentences(i),
        block = el('div', 'chapter-block');
      block.dataset.start = r.start;
      block.dataset.end = r.end;
      block.setAttribute('aria-label', c.title);
      const counts = { repeat: 0, normal: 0, skim: 0 };
      for (const sentence of items) counts[levelMap.get(sentence.id) || 'normal']++;
      const level = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      const top = button('', () => choose(i), `chapter-overview ${level}`);
      top.title = `${c.title} · ${formatTime(r.start)}–${formatTime(r.end)} · 点击选择整章`;
      top.setAttribute('aria-label', top.title);
      top.setAttribute('aria-pressed', String(studySelection.chapter === i));
      block.append(top);
      const parts = el('div', 'chapter-parts');
      top.onkeydown = (e) => {
        if (e.key === 'ArrowDown' && parts.firstElementChild) {
          e.preventDefault();
          parts.firstElementChild.focus();
        }
      };
      for (const [partIndex, sentence] of items.entries()) {
        const part = button(
          '',
          () => choose(i, sentence.id),
          `chapter-part ${levelMap.get(sentence.id) || 'normal'}`,
        );
        part.style.flex = '1 1 0';
        part.dataset.id = sentence.id;
        part.onmouseenter = () => choose(i, sentence.id);
        part.onfocus = part.onmouseenter;
        part.tabIndex =
          sentence.id === studySelection.sentenceId ||
          (!studySelection.sentenceId && i === studySelection.chapter && partIndex === 0)
            ? 0
            : -1;
        part.onkeydown = (e) => {
          let target;
          if (e.key === 'ArrowLeft') target = Math.max(0, partIndex - 1);
          if (e.key === 'ArrowRight') target = Math.min(items.length - 1, partIndex + 1);
          if (e.key === 'Home') target = 0;
          if (e.key === 'End') target = items.length - 1;
          if (target !== undefined) {
            e.preventDefault();
            parts.children[target]?.focus();
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            top.focus();
          }
        };
        part.title = `${formatTime(sentence.start)}–${formatTime(sentence.end)} ${sentence.rawText}`;
        part.setAttribute('aria-label', part.title);
        part.setAttribute(
          'aria-pressed',
          String(studySelection.chapter === i && studySelection.sentenceId === sentence.id),
        );
        parts.append(part);
      }
      const selectAtPointer = (e) => {
        const box = parts.getBoundingClientRect();
        if (!box.width || !items.length) return;
        const ratio = Math.max(0, Math.min(0.999999, (e.clientX - box.left) / box.width));
        const item =
          items[
            Math.min(
              items.length - 1,
              e.clientX >= box.right - 1 ? items.length - 1 : Math.floor(ratio * items.length),
            )
          ];
        if (item) choose(i, item.id);
      };
      parts.addEventListener('pointermove', selectAtPointer);
      parts.addEventListener('click', selectAtPointer);
      block.onmouseenter = () => {
        choose(i);
        timeline
          .querySelectorAll('.chapter-block')
          .forEach((e) => e.classList.toggle('expanded', e === block));
      };
      block.addEventListener('focusin', (e) => {
        timeline
          .querySelectorAll('.chapter-block')
          .forEach((b) => b.classList.toggle('expanded', b === block));
        if (e.target === top) choose(i);
      });
      block.append(parts);
      timeline.append(block);
    });
  }
  const chosenSentence = record.sentences.find(
    (s) => s.id === studySelection.sentenceId && s.start >= range.start && s.start < range.end,
  );
  const scope = chosenSentence
    ? { start: chosenSentence.start, end: Math.min(chosenSentence.end, range.end) }
    : range;
  const heading = el('div', 'study-scope');
  heading.append(
    el('span', 'scope-title', selected.title),
    el(
      'span',
      'scope-time',
      `${formatTime(scope.start)}–${formatTime(scope.end)} · ${chosenSentence ? '所选句子' : '整章'}`,
    ),
  );
  list.dataset.start = scope.start;
  list.dataset.end = scope.end;
  const actions = el('div', 'row');
  actions.append(
    button(
      chosenSentence ? '↺ 复听所选片段' : '↺ 复听本章',
      () => playRange(scope, repeat),
      'text-btn',
    ),
  );
  if (chosenSentence)
    actions.append(button('返回整章', () => choose(studySelection.chapter), 'text-btn'));
  const chapterItems = chapterSentences(studySelection.chapter);
  const priorityIds = new Set(
    (record.studyMap || []).filter((r) => r.level === 'repeat').map((r) => r.fromSentenceId),
  );
  const priority = chapterItems.filter((s) => priorityIds.has(s.id));
  if (priority.length)
    actions.append(
      button('↺ 本章重点', () =>
        playRange(
          { ranges: priority.map((s) => ({ start: s.start, end: Math.min(s.end, range.end) })) },
          repeat,
        ),
      ),
    );
  heading.append(actions);
  list.append(heading);
  if (studyMode !== 'original' && chapterItems.some((s) => !s.translation))
    list.append(button('翻译未完成 · 生成译文', () => task('translation'), 'text-btn'));
  const reading = el('article', 'study-reading');
  const levels = new Map((record.studyMap || []).map((r) => [r.fromSentenceId, r]));
  const previewItems = chosenSentence ? [chosenSentence] : chapterItems;
  const renderSentence = (sentence) => {
    const r = levels.get(sentence.id) || { ...sentence, level: 'normal', reason: '尚未标记' };
    const item = el('span', `study-sentence study-text-${r.level}`),
      text = el(
        'span',
        'study-source',
        studyMode === 'translated'
          ? sentence.translation || '尚未翻译 · ' + sentence.rawText
          : sentence.rawText,
      );
    item.tabIndex = 0;
    item.dataset.id = sentence.id;
    item.append(text);
    if (studyMode === 'bilingual' && sentence.translation)
      item.append(el('span', 'study-translation', ' · ' + sentence.translation));
    if (sentence.id === studySelection.sentenceId) item.classList.add('selected');
    let popup;
    const target = () => sentence;
    const show = () => {
      if (!popup) {
        popup = el('span', 'study-tooltip');
        popup.setAttribute('role', 'group');
        popup.setAttribute('aria-label', '句子详情');
        popup.append(el('span', 'study-tooltip-reason', r.reason || '未提供说明'));
        const actions = el('span', 'row');
        const replay = button(`${formatTime(sentence.start)} 复听`, () =>
          playRange(target(), repeat),
        );
        actions.append(replay);
        const scopeLabel = el('span', 'study-unit-label', '当前句子');
        popup.append(scopeLabel);
        const select = el('select');
        select.setAttribute('aria-label', '修改学习等级');
        for (const [value, title] of [
          ['repeat', '重点复听'],
          ['normal', '正常听'],
          ['skim', '可略过'],
        ]) {
          const o = el('option', '', title);
          o.value = value;
          o.selected = value === r.level;
          select.append(o);
        }
        select.onchange = guard(async () => {
          const gen = generation,
            id = record.id;
          if (record.videoInfo.platform === 'demo') {
            record.studyMap = record.studyMap.map((x) =>
              x.fromSentenceId === sentence.id
                ? { ...x, level: select.value, reason: '手动标记', manual: true }
                : x,
            );
          } else {
            const updated = await rpc('OVERRIDE', {
              recordId: id,
              sentenceId: sentence.id,
              level: select.value,
            });
            if (gen !== generation || id !== record?.id) return;
            record = updated;
          }
          renderStudy();
          renderSentences();
        });
        const askButton = button('提问', () => ask(target()));
        select.title = '修改当前句的学习等级';
        actions.append(
          select,
          askButton,
          button('＋ 笔记', () => editNote(target())),
        );
        popup.append(actions);
        item.append(popup);
        popup.onclick = (e) => e.stopPropagation();
      }
      $$('.study-tooltip').forEach((p) => {
        if (p !== popup) p.hidden = true;
      });
      popup.hidden = false;
      const box = item.getBoundingClientRect(),
        width = Math.min(390, innerWidth - 32);
      popup.style.width = width + 'px';
      popup.style.left = Math.max(16, Math.min(box.left, innerWidth - width - 16)) + 'px';
      popup.style.top =
        Math.max(8, Math.min(box.bottom, innerHeight - popup.offsetHeight - 100)) + 'px';
    };
    const hide = () => {
      if (popup && !item.matches(':focus-within')) {
        popup.hidden = true;
      }
    };
    item.onmouseenter = show;
    item.onmouseleave = hide;
    item.onfocusin = show;
    item.onfocusout = () => setTimeout(hide, 0);
    text.onclick = () => {
      if (!getSelection()?.toString()) seekPlay(sentence.start).catch(error);
    };
    item.onkeydown = (e) => {
      if (e.target === item && e.key === 'Enter') {
        e.preventDefault();
        seekPlay(sentence.start).catch(error);
      }
      if (e.key === 'Escape' && popup) {
        popup.hidden = true;
        item.blur();
      }
    };
    reading.append(item);
  };
  for (const sentence of previewItems) renderSentence(sentence);
  list.append(reading);
  highlight();
  scheduleStudyFit();
}
function renderOverview() {
  const root = $('#overview-content');
  const openSections =
    root.dataset.record === record?.id
      ? new Set([...root.querySelectorAll('.overview-extra[open]')].map((x) => x.dataset.section))
      : new Set();
  root.dataset.record = record?.id || '';
  root.replaceChildren();
  const a = record?.analysis;
  if (!a) {
    root.append(
      el('div', 'placeholder', '章节、金句与分段精讲会出现在这里。\n所有时间点都来自原始字幕。'),
    );
    return;
  }
  for (const [key, title] of [
    ['chapters', '章节地图'],
    ['quotes', '值得记住的话'],
    ['explanations', '分段精讲'],
  ]) {
    if (key === 'quotes' || key === 'explanations') {
      const details = el('details', 'overview-extra');
      details.dataset.section = key;
      details.open = openSections.has(key);
      details.append(el('summary', '', title));
      const content = el('div');
      details.append(content);
      root.append(details);
      if (
        key === 'explanations' &&
        !a.detailsSignature?.startsWith('[4,') &&
        Math.max(
          (a[key] || []).length,
          Object.values(record.analysisChunks || {}).flatMap((c) => c.explanations || []).length,
        ) > 12 &&
        record.videoInfo.platform !== 'demo'
      ) {
        const message = el('p', 'hint', '这些精讲尚未精选，将合并重复观点并保留关键难点。');
        content.append(message);
        const refine = button('精选精讲', async () => {
          const gen = generation,
            id = record.id;
          refine.disabled = true;
          message.textContent = '正在精选关键难点…';
          try {
            const result = await rpc('TASK', {
              recordId: id,
              capability: 'curateDetails',
              args: {},
            });
            if (gen !== generation || id !== record?.id) return;
            record.analysis = result.analysis;
            renderOverview();
          } catch (e) {
            message.textContent = '精讲精选未完成，可重试。';
            throw e;
          } finally {
            refine.disabled = false;
          }
        });
        content.append(refine);
        details.addEventListener(
          'toggle',
          () => {
            if (details.open && !refine.disabled) refine.click();
          },
          { once: true },
        );
      } else renderDetailBrowser(content, a[key] || [], key === 'quotes');
      continue;
    }
    root.append(el('h3', '', title));
    for (const x of a[key] || []) {
      const card = el('article', 'card');
      card.append(
        button(formatTime(x.start), () =>
          playRange(
            {
              start: x.start,
              end: x.end || record.sentences.find((s) => s.id === x.sentenceId)?.end,
            },
            1,
          ),
        ),
        button(x.title || x.quote, () => seekPlay(x.start), 'overview-title'),
        el('p', '', x.summary || x.body || x.reason),
      );
      const row = el('div', 'row');
      row.append(
        button('复制', () => copy(x.quote || `${x.title}\n${x.summary || x.body || ''}`)),
        button('提问', () => ask(x)),
        button('＋ 笔记', () =>
          editNote({
            ...x,
            rawText: x.quote || x.summary || x.body,
            id: x.fromSentenceId || x.sentenceId,
          }),
        ),
      );
      card.append(row);
      root.append(card);
    }
  }
}

function renderChats() {
  const root = $('#chat-history');
  root.replaceChildren();
  const topics = conversationTopics(chats),
    history = $('#qa-topic-list');
  history.replaceChildren();
  $('#qa-topics').hidden = !topics.length;
  for (const t of topics) {
    const entry = button(t.title || '解释', () => resumeTopic(t.items.at(-1)), 'qa-topic');
    entry.setAttribute('aria-current', String(t.id === qaTopicId));
    history.append(entry);
  }
  const topic = topics.find((t) => t.id === qaTopicId);
  for (const c of topic?.items || []) {
    const node = el('article', 'message qa-answer-card');
    node.append(el('div', 'question', c.question));
    if (c.pronunciation) node.append(el('p', 'qa-pronunciation', c.pronunciation));
    if (c.meaning) node.append(el('p', 'qa-meaning', c.meaning));
    if (c.headline) node.append(el('h3', 'qa-headline', c.headline));
    node.append(el('p', 'answer', c.answer || ''));
    if (c.answerEn) node.append(el('p', 'answer qa-answer-en', c.answerEn));
    if (c.supplement) {
      const extra = el('details', 'qa-supplement');
      extra.append(el('summary', '', '补充说明 · 非视频原话'), el('p', '', c.supplement));
      node.append(extra);
    }
    if (c.citations?.length) {
      const evidence = el('div', 'qa-evidence');
      evidence.append(el('div', 'qa-evidence-title', '视频原话'));
      const more = el('details', 'qa-more-evidence');
      more.append(el('summary', '', '更多原文依据'));
      let count = 0;
      for (const r of c.citations) {
        const sentence = record?.sentences.find((s) => s.id === r.sentenceId);
        if (!sentence) continue;
        const quote = el('div', 'qa-quote');
        quote.append(
          el('blockquote', '', r.quote),
          button(`${formatTime(sentence.start)} · ▶ 播放`, () => playRange(sentence, 1)),
          button('↺ 再听一次', () => playRange(sentence, 2)),
          button('查看字幕', () => showSource(sentence)),
        );
        (count++ ? more : evidence).append(quote);
      }
      if (count > 1) evidence.append(more);
      node.append(evidence);
    } else node.append(el('p', 'unverified', '未找到可核对的字幕引用。'));
    if (c.rejectedCitations)
      node.append(el('p', 'unverified', '部分引用未通过原文校验，已移除；请核对回答。'));
    const row = el('div', 'row');
    row.append(
      button('继续追问', () => resumeTopic(c)),
      button(savedAnswerNote(c) ? '已保存 · 补充想法' : '＋ 保存笔记', () => saveAnswerNote(c)),
      button('复制', () => copy(answerText(c))),
    );
    node.append(row);
    root.append(node);
  }
  renderQaContext();
}
async function noteRpc(type, data) {
  if (!(data.note?.recordId || data.recordId || '').startsWith('demo:') || !ext)
    return rpc(type, data);
  if (type === 'SAVE_NOTE') {
    const n = { ...data.note, id: data.note.id || crypto.randomUUID(), updatedAt: Date.now() };
    const a = demoNotes().filter((x) => x.id !== n.id);
    a.push(n);
    localStorage.setItem('cuemind-demo-notes', JSON.stringify(a));
    return n;
  }
  if (type === 'DELETE_NOTE') {
    localStorage.setItem(
      'cuemind-demo-notes',
      JSON.stringify(demoNotes().filter((x) => x.id !== data.id)),
    );
    return;
  }
  return demoNotes();
}
function editNote(s = current(), existing = null, body = '') {
  if (!existing) requireRecord();
  if (busy || captureInfo?.recordId === record?.id)
    throw new Error('请等待当前任务完成后再保存笔记。');
  if (!existing && s?.fromSentenceId && s?.toSentenceId) {
    const from = record.sentences.findIndex((x) => x.id === s.fromSentenceId),
      to = record.sentences.findIndex((x) => x.id === s.toSentenceId);
    if (from >= 0 && to >= from)
      s = { ...s, sentenceIds: record.sentences.slice(from, to + 1).map((x) => x.id) };
  }
  const original = record?.sentences.find((x) => x.id === s?.id);
  const source = s?.rawText;
  editing = existing || {
    recordId: record.id,
    videoKey: record.videoKey,
    videoInfo: record.videoInfo,
    platform: record.videoInfo.platform,
    videoId: record.videoInfo.videoId,
    page: record.videoInfo.page,
    timestamp: s?.start ?? time,
    end: original?.end || s?.end,
    sentenceIds: original ? [original.id] : [],
    sourceText: original
      ? typeof source === 'string' && original.rawText.includes(source)
        ? source
        : original.rawText
      : '',
    body,
  };
  if (!existing && s?.sentenceIds?.length) {
    const ids = new Set(s.sentenceIds),
      items = record.sentences.filter((x) => ids.has(x.id));
    if (items.length) {
      editing.sentenceIds = items.map((x) => x.id);
      editing.sourceText = items.map((x) => x.rawText).join(' ');
      editing.timestamp = items[0].start;
      editing.end = Math.max(...items.map((x) => x.end));
    }
  }
  $('#note-source').textContent = editing.sourceText || '自由笔记';
  $('#note-body').value = editing.body || '';
  $('#refine-preview').hidden = true;
  $('#note-dialog').showModal();
}
function renderNotes() {
  const root = $('#notes-list');
  root.replaceChildren();
  $('#note-count').textContent = notes.length || '';
  const q = $('#note-search').value.toLowerCase();
  for (const n of notes.filter((n) =>
    `${n.body} ${n.sourceText} ${n.videoInfo?.title} ${n.videoInfo?.author}`
      .toLowerCase()
      .includes(q),
  )) {
    const card = el('article', 'card');
    if ($('#note-scope').value === 'all')
      card.append(el('h3', 'note-video-title', n.videoInfo?.title || '视频笔记'));
    card.dataset.noteId = n.id;
    const translated = n.translations?.[settings.targetLanguage || '简体中文'];
    const translatedText = translated?.source === n.body ? translated.text : '';
    card.append(
      el('span', 'eyebrow', `${formatTime(n.timestamp)} · ${n.videoInfo?.author || ''}`),
      el('p', '', mode === 'translated' && translatedText ? translatedText : n.body),
    );
    if (mode === 'bilingual' && translatedText) card.append(el('p', 'translation', translatedText));
    if (n.sourceText && n.sourceText !== n.body) card.append(el('blockquote', '', n.sourceText));
    const row = el('div', 'row');
    row.append(
      button('回到视频', async () => {
        if (n.videoKey === record?.videoKey)
          await playRange(
            {
              start: n.timestamp,
              end:
                n.end ||
                Math.max(
                  n.timestamp + 1,
                  ...record.sentences
                    .filter((s) => n.sentenceIds?.includes(s.id))
                    .map((s) => s.end),
                ),
            },
            1,
          );
        else if (ext) await chrome.tabs.create({ url: timestampUrl(n.videoInfo, n.timestamp) });
      }),
      button('编辑', () => editNote(null, n)),
      button('提问', () => {
        if (n.recordId !== record?.id) throw new Error('请先打开该笔记对应的视频再提问。');
        ask({ ...n, start: n.timestamp });
      }),
      button('复制', () =>
        copy(
          mode === 'translated' && translatedText
            ? translatedText
            : mode === 'bilingual' && translatedText
              ? n.body + '\n' + translatedText
              : n.body,
        ),
      ),
      button('复制时间链接', () => copy(timestampUrl(n.videoInfo, n.timestamp))),
      button('删除', async () => {
        await noteRpc('DELETE_NOTE', { id: n.id, recordId: n.recordId });
        notes = notes.filter((x) => x.id !== n.id);
        renderNotes();
        renderChats();
        toast('笔记已删除', async () => {
          const restored = await noteRpc('SAVE_NOTE', { note: n });
          if ($('#note-scope').value === 'all' || restored.recordId === record?.id) {
            notes = [restored, ...notes.filter((x) => x.id !== restored.id)];
            renderNotes();
            renderChats();
          }
        });
      }),
    );
    if (n.recordId === record?.id) {
      const sources = noteSources(n, record.sentences);
      if (sources.length) {
        row.firstElementChild.textContent = sources.length > 1 ? '回听首条来源' : '回听来源';
        row.firstElementChild.onclick = () => playRange(sources[0], 1).catch(error);
        const details = el('details', 'note-sources');
        details.append(el('summary', '', '原文来源'));
        for (const source of sources) {
          const item = el('div');
          item.append(
            el('p', '', source.rawText),
            button(formatTime(source.start) + ' · 回听', () => playRange(source, 1)),
            button('查看字幕', () => showSource(source)),
          );
          details.append(item);
        }
        card.append(details);
      }
    }
    card.append(row);
    root.append(card);
  }
  if (notes.length && !root.children.length)
    root.append(el('p', 'placeholder', '没有找到匹配的笔记，试试其他关键词。'));
  if (!notes.length)
    root.append(
      el('div', 'placeholder', '一句原文，一个想法。\n从字幕或 AI 回答旁保存你的第一条笔记。'),
    );
}
async function copy(text) {
  if (!String(text || '').trim()) throw new Error('当前没有可复制的内容。');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
      : [];
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(field);
    try {
      field.select();
      if (!document.execCommand('copy')) throw new Error('复制未成功，请重试或使用导出字幕。');
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        ranges.forEach((range) => selection.addRange(range));
      }
    }
  }
  toast('已复制');
}
function download(text, extName, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = `${(record?.videoInfo.title || 'CueMind').replace(/[<>:"/\\|?*]/g, '_').slice(0, 100)}.${extName}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#refresh').onclick = guard(() => load());
$('#start').onclick = guard(() => load());
$('#tracks').onchange = guard(() => load(false, $('#tracks').value));
$('#settings').onclick = () =>
  ext ? chrome.runtime.openOptionsPage() : location.assign('settings.html');
function syncModeControls() {
  $('#transcript-mode').value = mode;
  $$('[data-note-mode]').forEach((b) => b.classList.toggle('active', b.dataset.noteMode === mode));
}
function changeMode(value) {
  mode = value;
  syncModeControls();
  renderSentences();
  renderNotes();
  saveReading();
  maybeTranslateVideo();
}
$('#demo').onclick = guard(async () => {
  const gen = ++generation;
  await leaveVideo();
  if (gen !== generation) return;
  busy = false;
  $('#cancel').hidden = true;
  record = demoRecord();
  tabId = null;
  active = 0;
  mode = 'bilingual';
  limit = 70;
  listOffset = 0;
  renderTracks();
  notes = demoNotes();
  chats = [];
  qaFollowup = null;
  qaTopicId = null;
  qaSelectedText = '';
  qaPinnedId = null;
  selectedIds = [];
  $('#question').value = '';
  $('#qa-scope').value = 'sentence';
  $('#qa-request-state').hidden = true;
  $('#chat-form button[type=submit]').disabled = false;
  $('#chat-form button[type=submit]').textContent = '提问 ↗';
  $$('[data-qa-shortcut]').forEach((b) => (b.disabled = false));
  render();
  syncModeControls();
  status('正在体验原创示例，未连接视频播放器，也不会发送 AI 请求。');
});
$('#transcript-mode').onchange = (e) => changeMode(e.currentTarget.value);
$$('[data-note-mode]').forEach((b) => (b.onclick = () => changeMode(b.dataset.noteMode)));
$('#search').oninput = () => {
  listOffset = 0;
  limit = 70;
  renderSentences();
};
$('#more').onclick = () => pageSentences(listOffset + limit);
$('#locate').onclick = () => {
  resumeFollow();
  openSearch(false);
  renderSentences();
  locate();
};
$('#translate').onclick = guard(() => {
  const bounds = replayArmed ? replayBounds() : null;
  return task(
    'translation',
    bounds
      ? { selectedIds: record.sentences.slice(bounds.from, bounds.to + 1).map((s) => s.id) }
      : {},
  );
});
$('#retry-translation').onclick = guard(() => task('translation'));
$('#deduplicate-asr').onclick = guard(async () => {
  if (!record) return;
  await syncTaskState();
  if (busy || backgroundBusy || recording) throw new Error('请先完成或取消当前任务。');
  const id = record.id,
    gen = generation;
  const result = await rpc('DEDUPLICATE_ASR', { recordId: id });
  if (gen !== generation || record?.id !== id) return;
  record = result.record;
  render();
  await bindPlayer(true);
  status(
    result.removed
      ? `已合并 ${result.removed} 条重复字幕，其他版本已备份在本机。`
      : '未发现符合合并条件的重复字幕。',
  );
});
$('#analyze-study').onclick = guard(() => task('study'));
$('#analyze-overview').onclick = guard(() => task('analysis'));
$('#cancel').onclick = guard(() => rpc('CANCEL', { recordId: record?.id }));
for (const [id, delta] of [
  ['previous', -1],
  ['next', 1],
])
  $('#' + id).onclick = guard(() => expandReplay(delta));
$('#replay').onclick = guard(async () => {
  await replayEdits;
  resumeFollow();
  replayStarting++;
  try {
    await playRange(replayTarget(), repeat);
    replayArmed = false;
    updateReplayScope();
  } finally {
    replayStarting--;
  }
});
$('#loop').onclick = guard(async () => {
  repeat = repeat === 1 ? 3 : repeat === 3 ? -1 : 1;
  $('#loop').textContent = repeat === -1 ? '循环' : `听 ${repeat} 次`;
  if (ext && (tabId || localAudioMode) && record && record.videoInfo.platform !== 'demo')
    await rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: 'repeat', repeat, videoKey: record.videoKey },
    });
});
async function stop() {
  const wasSmart = smart;
  smart = false;
  lastSmartRate = null;
  $('#smart').textContent = '智能速度：关闭';
  if (ext && (tabId || localAudioMode) && record && record.videoInfo.platform !== 'demo') {
    await rpc('PLAYER_COMMAND', { tabId, command: { action: 'stop', videoKey: record.videoKey } });
    if (wasSmart)
      await rpc('PLAYER_COMMAND', {
        tabId,
        command: { action: 'rate', rate: normalRate, videoKey: record.videoKey },
      });
  }
  $('#stop').hidden = true;
  toast('已停止复听');
}
let replayScroll = 0;
$('#open-replay').onclick = () => {
  replayScroll = scrollY;
  studySelection = { recordId: null, chapter: 0, sentenceId: null };
  renderStudy();
  if (!busy) $('#replay-status').hidden = true;
  $('#replay-dialog').showModal();
  scheduleStudyFit();
};
$('#close-replay').onclick = () => $('#replay-dialog').close();
$('#replay-dialog').addEventListener('close', () => {
  $$('.study-tooltip').forEach((p) => (p.hidden = true));
  requestAnimationFrame(() => {
    if (!$('#transcript').classList.contains('active')) return;
    window.scrollTo({ top: replayScroll, behavior: 'instant' });
    if (followPlayback && active >= 0 && !getSelection()?.toString()) locate();
  });
});
$('#study-mode').onchange = () => {
  studyMode = $('#study-mode').value;
  renderStudy(true);
  const selected = $('.study-sentence.selected');
  if (selected) scrollStudySentence(selected, true);
};
$('#stop').onclick = guard(stop);
$('#stop-smart').onclick = guard(stop);
$('#highlights').onclick = guard(async () => {
  requireRecord();
  const lo = Number($('#study-list').dataset.start || 0),
    hi = Number($('#study-list').dataset.end || record.videoInfo.duration);
  const ranges = (record.studyMap || [])
    .filter((x) => x.level === 'repeat' && x.start >= lo && x.start < hi)
    .map((x) => ({ ...x, end: Math.min(x.end, hi) }));
  if (!ranges.length) throw new Error('还没有重点，请先生成学习地图或手动标记。');
  await playRange({ ranges }, 1);
});
$('#smart').onclick = guard(async () => {
  requireRecord();
  if (recording) throw new Error('请先完成音频识别');
  if (!record.studyMap?.length) throw new Error('请先生成学习地图');
  smart = !smart;
  lastSmartRate = null;
  $('#smart').textContent = `智能速度：${smart ? '开启' : '关闭'}`;
  if (!smart && ext && record.videoInfo.platform !== 'demo')
    await rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: 'rate', rate: normalRate, videoKey: record.videoKey },
    });
});
function resetQaFollowup() {
  qaFollowup = null;
  qaTopicId = null;
  qaSelectedText = '';
  $('#qa-followup').hidden = true;
  renderChats();
}
$('#qa-followup').onclick = newQuestion;
$('#qa-new').onclick = newQuestion;
$('#question').oninput = () => {
  if ($('#question').value.trim() && !qaPinnedId && $('#qa-scope').value !== 'video') {
    qaPinnedId = qaSentence()?.id || null;
    renderQaContext();
  }
};
$('#qa-scope').onchange = () => {
  resetQaFollowup();
  if ($('#qa-scope').value === 'video') {
    qaPinnedId = null;
    selectedIds = [];
  }
  renderQaContext();
};

$('#chat-form').onsubmit = guard(async (e) => {
  e.preventDefault();
  if (busy) return;
  const input = $('#question'),
    question = input.value.trim();
  if (!question) return;
  const gen = generation,
    scope = $('#qa-scope').value,
    anchor = qaSentence(),
    ids =
      scope === 'video'
        ? []
        : scope === 'sentence' && anchor
          ? [anchor.id]
          : selectedIds.length
            ? [...selectedIds]
            : anchor
              ? [anchor.id]
              : [];
  if (scope !== 'video' && anchor) qaPinnedId = anchor.id;
  const topicId = qaTopicId || crypto.randomUUID();
  const history = qaFollowup
    ? [
        ...(qaFollowup.history || []),
        {
          question: qaFollowup.question,
          answer: [
            qaFollowup.headline,
            qaFollowup.answer,
            qaFollowup.answerEn,
            qaFollowup.supplement,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ].slice(-6)
    : [];
  const submit = $('#chat-form button[type=submit]');
  submit.disabled = true;
  submit.textContent = '回答中…';
  $('#qa-request-state').hidden = false;
  $('#qa-request-state').textContent = '正在结合原文回答…';
  $$('[data-qa-shortcut]').forEach((b) => (b.disabled = true));
  try {
    const result = await task('qa', {
      question,
      scope,
      selectedIds: ids,
      currentTime: anchor?.start ?? time,
      history,
      topicId,
      selectedText: qaSelectedText,
      answerLanguage: $('#qa-language').value,
    });
    if (result) {
      const chat = {
        question,
        ...result,
        topicId,
        history,
        context: result.context || {
          scope,
          selectedIds: ids,
          currentTime: anchor?.start ?? time,
          selectedText: qaSelectedText,
          answerLanguage: $('#qa-language').value,
        },
      };
      chats.push(chat);
      qaFollowup = chat;
      qaTopicId = topicId;
      if (input.value.trim() === question) input.value = '';
      $('#qa-request-state').hidden = true;
      $('#qa-followup').textContent = '正在追问：' + question + ' · 结束追问 ×';
      $('#qa-followup').hidden = false;
      renderChats();
    }
  } catch (e) {
    if (gen === generation) {
      $('#qa-request-state').textContent =
        '回答未完成：' + e.message + '。问题已保留，可重新发送。';
    }
    throw e;
  } finally {
    if (gen === generation) {
      submit.disabled = false;
      submit.textContent = '提问 ↗';
      $$('[data-qa-shortcut]').forEach((b) => (b.disabled = false));
      renderQaContext();
    }
  }
});
$('#new-note').onclick = guard(() => editNote());
$('#close-note').onclick = () => $('#note-dialog').close();
$('#note-search').oninput = renderNotes;
$('#note-scope').onchange = guard(async () => {
  const gen = generation,
    id = record?.id,
    scope = $('#note-scope').value;
  const result =
    record?.videoInfo.platform === 'demo'
      ? demoNotes()
      : scope === 'current' && !id
        ? []
        : await rpc('NOTES', { recordId: scope === 'all' ? undefined : id });
  if (gen !== generation || scope !== $('#note-scope').value) return;
  notes = result;
  renderNotes();
});
$('#note-form').onsubmit = guard(async (e) => {
  e.preventDefault();
  const body = $('#note-body').value.trim();
  if (!body) return;
  const gen = generation;
  const n = await noteRpc('SAVE_NOTE', { note: { ...editing, body } });
  $('#note-dialog').close();
  if (gen === generation && ($('#note-scope').value === 'all' || n.recordId === record?.id)) {
    notes = [n, ...notes.filter((x) => x.id !== n.id)];
    renderNotes();
  }
  toast('笔记已保存到本机');
});
$('#refine-note').onclick = guard(async () => {
  if (editing.recordId !== record?.id) throw new Error('请先读取该笔记所属视频，再整理笔记。');
  const result = await task('refine', {
    body: $('#note-body').value,
    sourceText: editing.sourceText,
    selectedIds: editing.sentenceIds,
  });
  if (result) {
    $('#refine-text').textContent = result.body;
    $('#refine-preview').hidden = false;
  }
});
$('#replace-note').onclick = () => {
  $('#note-body').value = $('#refine-text').textContent;
  $('#refine-preview').hidden = true;
};
$('#append-note').onclick = () => {
  $('#note-body').value += '\n\n' + $('#refine-text').textContent;
  $('#refine-preview').hidden = true;
};
$('#cancel-refine').onclick = () => ($('#refine-preview').hidden = true);
$('#export').onclick = () => $('#export-dialog').showModal();
$$('[data-export]').forEach(
  (b) =>
    (b.onclick = guard(async () => {
      const type = b.dataset.export;
      if (type === 'json') {
        const data = await rpc('BACKUP');
        download(JSON.stringify(data, null, 2), 'json', 'application/json');
      } else {
        const exported = requireRecord();
        const local =
          exported.videoInfo.platform === 'demo'
            ? demoNotes()
            : await rpc('NOTES', { recordId: exported.id });
        if (type === 'md')
          download(
            markdown(exported, local, $('#include-transcript').checked),
            'md',
            'text/markdown',
          );
        if (type === 'mindmap') download(mindmap(exported), 'mmd');
        if (type === 'outline') download(outline(exported), 'outline.md', 'text/markdown');
        if (type === 'srt') download(subtitles(exported), 'srt');
        if (type === 'txt') download(transcriptText(), 'txt');
      }
      toast('文件已导出');
    })),
);
$('#show-asr').onclick = () => {
  asrOpen = true;
  $('#import-dialog').close();
  showTab('transcript');
  $('#asr-box').hidden = false;
  $('#asr-box').scrollIntoView({ block: 'center' });
};
$('#import-existing').onclick = () => {
  $('#import-dialog').close();
  $('#import').click();
};
$('#restore').onchange = guard(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) throw new Error('备份文件大于 50 MB');
  await rpc('RESTORE', { backup: JSON.parse(await file.text()) });
  toast('学习资料已恢复，重新读取视频即可查看');
  e.target.value = '';
});
$('#import').onchange = guard(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const gen = generation;
  if (busy || recording) throw new Error('请先完成或取消当前任务');
  if (file.size > 10 * 1024 * 1024) throw new Error('字幕文件大于 10 MB');
  try {
    const raw = parseSubtitle(await file.text());
    if (gen !== generation) return;
    let info = record?.videoInfo;
    if (ext && (!info || info.platform === 'demo')) {
      const tab = await chooseTab();
      if (gen !== generation) return;
      tabId = tab.id;
      info = (await rpc('INSPECT', { tabId })).info;
    }
    if (gen !== generation) return;
    if (!info) throw new Error('请先加载扩展并打开视频，再导入字幕');
    const imported = await rpc('IMPORT', { info, raw });
    if (gen !== generation) return;
    generation++;
    newQuestion();
    record = imported;
    listOffset = 0;
    active = -1;
    await hydrate();
    await bindPlayer();
    status('字幕已导入，旧学习记录仍保留。');
  } finally {
    e.target.value = '';
  }
});
const dataURL = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
$('#audio').onchange = guard(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!record) throw new Error('请先读取视频信息');
  if (!speechSettings(settings, record.videoInfo.platform).asrKey?.trim()) {
    requestSetup('speech');
    e.target.value = '';
    return;
  }
  if (busy || recording) throw new Error('请先完成或取消当前任务');
  if (file.size > 24 * 1024 * 1024) throw new Error('音频不得超过 24 MB');
  const gen = generation,
    id = record.id;
  busy = true;
  updateTranslationPrompt();
  renderCapture();
  renderQaContext();
  $('#cancel').hidden = false;
  status('正在上传音频并转写…');
  try {
    const audio = await prepareSpeechAudio(
      file,
      speechSettings(settings, record.videoInfo.platform),
    );
    const dataUrl = await dataURL(audio);
    if (gen !== generation) return;
    const result = await rpc('ASR_FILE', {
      recordId: id,
      dataUrl,
      filename: audio === file ? file.name : 'audio.wav',
      offset: Number($('#audio-offset').value),
    });
    if (gen !== generation) return;
    record = result;
    mode = 'bilingual';
    syncModeControls();
    await hydrate();
    await bindPlayer();
    status('音频转写完成。');
  } catch (e) {
    if (gen === generation) throw e;
  } finally {
    if (gen === generation) {
      busy = false;
      $('#cancel').hidden = true;
    }
    e.target.value = '';
  }
});
async function startCapture(rangeEnd, audioOnly = false) {
  if (localAudioMode)
    throw new Error('本地学习请在音频库中重试已保存片段；采集新音频请返回在线视频。');
  if (recording) {
    await rpc('CAPTURE_STOP');
    if (captureInfo) captureInfo.stopping = true;
    renderCapture();
    return;
  }
  if (!record) throw new Error('请先读取视频信息');
  if (!audioOnly && !speechSettings(settings, record?.videoInfo.platform).asrKey?.trim()) {
    requestSetup('speech');
    return;
  }
  await syncTaskState();
  if (busy || backgroundBusy) throw new Error('请先完成当前任务');
  const gen = generation,
    id = record.id,
    sourceTab = tabId;
  busy = true;
  try {
    status(audioOnly ? '正在准备保存当前播放音频…' : '正在检查语音服务连接，通过后开始采集音频…');
    const result = await rpc('CAPTURE_START', {
      recordId: id,
      tabId: sourceTab,
      audioOnly,
      ...(Number.isFinite(rangeEnd) ? { rangeEnd } : {}),
    });
    recording = true;
    captureInfo = { recordId: result.id, tabId: sourceTab, completed: 0 };
    renderCapture();
    if (gen !== generation) return;
    record = result;
    mode = 'bilingual';
    syncModeControls();
    notes = [];
    chats = [];
    selectedIds = [];
    active = -1;
    listOffset = 0;
    await hydrate();
    status('');
  } finally {
    if (gen === generation) busy = false;
  }
}
$('#record').onclick = guard(() => startCapture());
async function retryAsrSegment(segment) {
  await syncTaskState();
  if (busy || backgroundBusy || recording) throw new Error('请先完成当前任务');
  const gen = generation,
    id = record.id,
    sourceTab = tabId,
    videoKey = record.videoKey;
  const target = Math.max(0, segment.start);
  status('正在定位该片段，等待音频缓冲…');
  await rpc('PLAYER_COMMAND', {
    tabId: sourceTab,
    command: { action: 'seek', time: target, videoKey },
  });
  if (gen !== generation || record?.id !== id || tabId !== sourceTab) return;
  await rpc('PLAYER_COMMAND', {
    tabId: sourceTab,
    command: { action: 'pause', videoKey },
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (gen !== generation || record?.id !== id || tabId !== sourceTab) return;
    const state = await rpc('PLAYER_COMMAND', {
      tabId: sourceTab,
      command: { action: 'state', videoKey },
    });
    if (gen !== generation || record?.id !== id || tabId !== sourceTab) return;
    if (state.mediaErrorCode)
      throw new Error(`播放器报告媒体错误（代码 ${state.mediaErrorCode}），本次尚未调用 ASR。`);
    if (
      !state.seeking &&
      (state.readyState == null || state.readyState >= 2) &&
      Math.abs(state.time - target) < 0.75
    )
      break;
    if (Date.now() >= deadline)
      throw new Error(
        '等待该片段音频缓冲超时（20 秒），本次尚未调用 ASR。可先在该位置播放，再重试。',
      );
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  await startCapture(segment.end);
}
const asrLabels = {
  pending: '未开始',
  capturing: '正在采集音频',
  queued: '音频已采集，等待语音服务',
  recognizing: '正在识别原文',
  'source-ready': '原文成功，等待翻译',
  translating: '正在生成译文',
  done: '双语成功',
  'translation-failed': '原文成功，译文失败',
  'no-speech': '已识别，无可辨语音',
  failed: '识别失败',
  interrupted: '已中断',
};
function asrStatusText(segment) {
  const label = asrLabels[segment.status] || segment.status;
  const audio =
    ['queued', 'recognizing', 'failed', 'interrupted'].includes(segment.status) &&
    Number.isFinite(segment.audioBytes)
      ? ` · 音频 ${Math.max(1, Math.round(segment.audioBytes / 1024))} KB${Number.isFinite(segment.audioLevel) ? `，电平 ${Math.round(segment.audioLevel * 100)}%` : ''}`
      : '';
  const start = segment.status === 'recognizing' ? segment.recognizingAt : segment.queuedAt;
  if (!['recognizing', 'queued'].includes(segment.status) || !Number.isFinite(start))
    return label + audio;
  const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return segment.status === 'recognizing' && segment.timeoutMs
    ? `${label} · 已等待 ${elapsed}/${Math.ceil(segment.timeoutMs / 1000)} 秒${audio}`
    : `${label} · 已等待 ${elapsed} 秒${audio}`;
}
function refreshAsrElapsed() {
  const all = record?.transcriptMeta.asrSegments || [];
  const sessionId = record?.transcriptMeta.asrSessionId;
  const active = all.filter(
    (segment) =>
      (!sessionId || segment.sessionId === sessionId) &&
      ['recognizing', 'queued'].includes(segment.status),
  );
  for (const segment of active) {
    for (const row of $('#asr-segment-list').children) {
      if (row.dataset.segmentId !== segment.id) continue;
      const value = row.querySelector('strong');
      if (value) value.textContent = asrStatusText(segment);
    }
  }
  const last = all.findLast(
    (segment) =>
      (!sessionId || segment.sessionId === sessionId) &&
      ['capturing', 'queued', 'recognizing', 'translating'].includes(segment.status),
  );
  if (last && ['recognizing', 'queued'].includes(last.status))
    $('#asr-current-segment').textContent =
      `当前 ${formatTime(last.start)}–${formatTime(last.end)}：${asrStatusText(last)}`;
}
function renderAsrSegments() {
  const all = record?.transcriptMeta.asrSegments || [];
  const sessionId = record?.transcriptMeta.asrSessionId;
  $('#asr-progress').hidden = !all.length;
  if (!all.length) return;
  const duration =
    Number(record?.videoInfo?.duration) ||
    all.reduce((latest, segment) => Math.max(latest, Number(segment.end) || 0), 0);
  const timeline = buildAsrTimeline(duration, all, sessionId);
  const segments = sessionId ? all.filter((segment) => segment.sessionId === sessionId) : all;
  const originalReady = timeline.filter((segment) =>
    ['source-ready', 'translating', 'done', 'translation-failed'].includes(segment.status),
  ).length;
  const silent = timeline.filter((segment) => segment.status === 'no-speech').length;
  const bilingual = timeline.filter((segment) => segment.status === 'done').length;
  const failed = timeline.filter((segment) =>
    ['failed', 'translation-failed', 'interrupted'].includes(segment.status),
  ).length;
  $('#asr-plan-summary').textContent =
    `全片 ${formatTime(duration)} · ${timeline.length} 段 · 原文成功 ${originalReady}${silent ? ` · 无语音 ${silent}` : ''} · 双语完成 ${bilingual} · 失败 ${failed}`;
  const activeSegment = segments.findLast((segment) =>
    ['capturing', 'queued', 'recognizing', 'translating'].includes(segment.status),
  );
  const nextSegment = segments.find((segment) => segment.status === 'pending');
  $('#asr-current-segment').textContent = activeSegment
    ? `当前 ${formatTime(activeSegment.start)}–${formatTime(activeSegment.end)}：${asrStatusText(activeSegment)}`
    : recording && nextSegment
      ? `下一段 ${formatTime(nextSegment.start)}–${formatTime(nextSegment.end)}：等待播放`
      : busy || backgroundBusy
        ? '文本任务正在处理，可取消任务；已完成结果保存在本机。'
        : '当前没有正在处理的片段；已完成结果保存在本机。';
  const lastResult = segments.findLast((segment) =>
    ['source-ready', 'done', 'translation-failed', 'failed', 'interrupted', 'no-speech'].includes(
      segment.status,
    ),
  );
  $('#asr-last-segment').textContent = lastResult
    ? `已处理区间 ${formatTime(lastResult.start)}–${formatTime(lastResult.end)}：${asrStatusText(lastResult)}${lastResult.error ? ` · ${lastResult.error}` : ''}`
    : '';
  const list = $('#asr-segment-list');
  list.replaceChildren();
  for (const [index, segment] of timeline.entries()) {
    const row = el('div', 'asr-segment');
    row.dataset.status = segment.status;
    row.dataset.segmentId = segment.id;
    row.append(
      el('span', '', `${index + 1}. ${formatTime(segment.start)}–${formatTime(segment.end)}`),
      el('strong', '', `${asrStatusText(segment)}${segment.error ? ` · ${segment.error}` : ''}`),
    );
    if (['source-ready', 'translation-failed'].includes(segment.status)) {
      const selectedIds = record.sentences
        .filter(
          (sentence) =>
            !sentence.translation &&
            sentence.start < segment.end - 0.1 &&
            sentence.end > segment.start + 0.1,
        )
        .map((sentence) => sentence.id);
      if (selectedIds.length && selectedIds.length <= 70)
        row.append(
          button(
            '补译此段',
            guard(() => task('translation', { selectedIds })),
          ),
        );
    } else if (['failed', 'interrupted', 'pending'].includes(segment.status)) {
      row.append(
        button(
          '从此处识别',
          guard(() => retryAsrSegment(segment)),
        ),
      );
    }
    row.querySelectorAll('button').forEach((control) => {
      control.disabled = busy || backgroundBusy || recording;
    });
    list.append(row);
  }
}
function updateCaptureEndState(duration = record?.videoInfo?.duration) {
  if (recording || !record) return;
  const atEnd =
    Number.isFinite(duration) && duration > 0 && Math.floor(time) >= Math.floor(duration);
  $('#record').disabled = busy || backgroundBusy || atEnd;
  $('#record').textContent = atEnd
    ? '已到视频结尾'
    : record.transcriptMeta.source?.includes('whisper') && record.rawCaptions?.length
      ? '从当前进度继续识别'
      : '从当前位置连续识别';
}
function renderCapture() {
  let bar = $('#capture-controls');
  if (!bar) {
    bar = el('div', 'status');
    bar.id = 'capture-controls';
    $('#status').after(bar);
  }
  const mine = recording && captureInfo?.recordId === record?.id;
  bar.hidden = !recording;
  if (recording && !asrElapsedTimer) asrElapsedTimer = setInterval(refreshAsrElapsed, 1000);
  if (!recording && asrElapsedTimer) {
    clearInterval(asrElapsedTimer);
    asrElapsedTimer = null;
  }
  bar.replaceChildren();
  const raw = record?.rawCaptions || [],
    asr = record?.transcriptMeta.source?.includes('whisper'),
    span = raw.length
      ? `${formatTime(Math.min(...raw.map((r) => r.start)))}–${formatTime(Math.max(...raw.map((r) => r.end)))}`
      : '';
  $('#capture-summary').textContent =
    asr && raw.length
      ? `已生成 ${span} 的原文字幕，共 ${record.sentences.length} 句。${record.transcriptMeta.partial ? '部分转写未完成，已有字幕已保留。' : ''}`
      : '';
  renderAsrSegments();
  if (mine || asr) $('#asr-box').hidden = false;
  $('#record').disabled = recording ? !mine || !!captureInfo?.stopping : busy || backgroundBusy;
  $('#audio').disabled = busy || backgroundBusy || recording;
  const missingTranslations = asr
    ? record.sentences.filter((sentence) => !sentence.translation).length
    : 0;
  $('#retry-translation').hidden = !missingTranslations;
  $('#retry-translation').disabled = busy || backgroundBusy || recording;
  $('#deduplicate-asr').disabled = busy || backgroundBusy || recording;
  $('#retry-translation').textContent = `补齐未完成译文（${missingTranslations} 句）`;
  $('#retry-translation-help').hidden = !missingTranslations;
  $('#record').textContent =
    recording && !mine
      ? '另一视频正在转写'
      : mine
        ? captureInfo?.stopping
          ? '正在完成识别…'
          : '结束音频采集并生成字幕'
        : asr && raw.length
          ? '从当前进度继续识别'
          : '从当前位置连续识别';
  if (!recording) {
    updateCaptureEndState();
    return;
  }
  const completed = captureInfo?.completed;
  const progress = Number.isFinite(completed) ? ` · 已完成 ${completed} 批` : '';
  bar.append(
    el(
      'span',
      '',
      `${mine ? '' : '另一视频：'}${captureInfo?.stopping ? '音频采集已结束，正在完成剩余识别' : '正在采集播放音频并识别字幕'}${progress}`,
    ),
  );
  if (!captureInfo?.stopping)
    bar.append(
      button('结束音频采集', async () => {
        await rpc('CAPTURE_STOP');
        if (captureInfo) captureInfo.stopping = true;
        renderCapture();
      }),
    );
  bar.append(button('取消剩余转写', () => rpc('CAPTURE_STOP', { cancel: true })));
}

function pauseFollow(event) {
  locateRevision++;
  if (
    !$('#transcript').classList.contains('active') ||
    event?.target?.closest?.('dialog,.transcript-menu')
  )
    return;
  if (followPlayback) window.scrollTo({ top: window.scrollY, behavior: 'instant' });
  followPlayback = false;
  $('#transcript').dataset.followPlayback = 'false';
  updateLocateControl();
}
function resumeFollow() {
  replayViewAnchor = null;
  followPlayback = true;
  $('#transcript').dataset.followPlayback = 'true';
  updateLocateControl();
}
window.addEventListener('wheel', pauseFollow, { passive: true });
window.addEventListener('touchmove', pauseFollow, { passive: true });
window.addEventListener('pointerdown', (e) => {
  if (e.clientX >= document.documentElement.clientWidth) pauseFollow();
});
window.addEventListener('keydown', (e) => {
  if (
    ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
    !e.target?.closest?.('input,textarea,select')
  )
    pauseFollow(e);
});

window.addEventListener('pagehide', () => {
  saveReading();
  clearTimeout(panelArrow?.timer);
  if (ext && (tabId || localAudioMode) && record && record.videoInfo.platform !== 'demo')
    rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: 'keyboard', videoKey: record.videoKey, keyboardEnabled: false },
    }).catch(() => {});
  if (smart && ext && (tabId || localAudioMode) && record && record.videoInfo.platform !== 'demo')
    rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: 'rate', rate: normalRate, videoKey: record.videoKey },
    }).catch(() => {});
});
document.addEventListener('keydown', (e) => {
  if (
    e.isComposing ||
    e.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
  )
    return;
  if (e.key === '/') {
    e.preventDefault();
    showTab('transcript');
    openSearch(true);
  }
  if (
    e.key.toLowerCase() === 'n' &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !$$('dialog[open]').length
  ) {
    e.preventDefault();
    quickNote().catch(error);
  }
  if (e.key === 'Escape' && $('.transcript-more').open) {
    e.preventDefault();
    closeTools();
    return;
  }
  if (e.key === 'Escape' && !$$('dialog[open]').length) stop().catch(error);
  if (
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !$$('dialog[open]').length &&
    $('#transcript').classList.contains('active') &&
    ['ArrowLeft', 'ArrowRight', ' '].includes(e.key) &&
    !(e.key === ' ' && e.target?.closest?.('button,summary,a') && !e.target?.closest?.('.playback'))
  ) {
    e.preventDefault();
    if (!e.repeat) {
      if (e.key === ' ') spacePlayback().catch(error);
      else panelArrowKey(e.key);
    }
    return;
  }
  if (e.altKey) {
    const ids = { j: 'previous', k: 'replay', l: 'next', r: 'loop' };
    if (ids[e.key.toLowerCase()]) {
      e.preventDefault();
      $('#' + ids[e.key.toLowerCase()]).click();
    }
  }
});
if (ext) {
  chrome.tabs.onActivated.addListener(async (info) => {
    if (localAudioMode) return;
    try {
      const tab = await chrome.tabs.get(info.tabId);
      if (tab.url?.startsWith(chrome.runtime.getURL(''))) return;
      await load();
    } catch {}
  });
  chrome.tabs.onUpdated?.addListener((id, change) => {
    if (localAudioMode) return;
    if (id !== tabId || !change.url) return;
    const nextKey = keyFromUrl(change.url);
    if (nextKey && !matchesVideoUrl(record?.videoKey || loadingVideoKey, change.url))
      load().catch(error);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = changes.settings.newValue || {};
      render();
      bindPlayer();
    }
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type !== 'EVENT') return;
    if (m.event === 'data-managed') {
      if (m.action === 'reset') localStorage.clear();
      if (m.action === 'delete-notes') localStorage.removeItem('cuemind-demo-notes');
      generation++;
      progressVersion++;
      busy = false;
      notes = [];
      chats = [];
      replaySelection = null;
      replayArmed = false;
      if (m.action === 'reset') {
        leaveVideo();
        record = null;
        tabId = null;
        settings = {};
        render();
        status('本地数据已重置，请重新读取视频。');
      } else if (record) {
        const gen = generation;
        rpc('GET_RECORD', { recordId: record.id })
          .then((r) => {
            if (gen === generation) {
              record = r;
              hydrate(gen).then(() => {
                if (gen === generation && m.action === 'clear-cache')
                  focus
                    .refresh(true)
                    .then(() => renderSentences())
                    .catch(error);
              });
            }
          })
          .catch(error);
      }
      return;
    }
    if (m.event === 'progress' && m.capability === 'focus' && m.recordId === record?.id) {
      focus.refresh().catch(() => {});
      return;
    }
    if (m.event === 'progress' && busy && m.recordId === record?.id) {
      const gen = generation,
        version = ++progressVersion;
      const label =
        {
          translation: '正在补全字幕译文',
          study: '正在分析学习地图',
          analysis: '正在生成视频概览',
          boundary: '正在整理完整句',
        }[m.capability] || '正在处理';
      status(
        `${label} ${m.completed}/${m.total} 批${m.failed ? ' · ' + m.failed + ' 批未完成' : ''}`,
      );
      rpc('GET_RECORD', { recordId: record.id })
        .then((r) => {
          if (gen === generation && version === progressVersion && busy && r.id === record?.id) {
            record = r;
            renderSentences();
            renderStudy();
            renderOverview();
            updateTranslationPrompt();
            if (m.capability === 'translation') focus.sendOverlay(true).catch(() => {});
          }
        })
        .catch(() => {});
    }
    if (
      m.event === 'PLAYER_SHORTCUT' &&
      m.tabId === tabId &&
      m.videoKey === record?.videoKey &&
      keyboardConfig().keyboardEnabled
    ) {
      if (m.action === 'expand') expandReplay(m.direction).catch(error);
      else if (m.action === 'space') spacePlayback().catch(error);
      else {
        replayViewAnchor = null;
        replaySelection = null;
        replayArmed = false;
        updateReplayScope();
      }
      return;
    }
    if (m.event === 'PLAYER_TICK') receivePlayerState(m);
    if (
      m.event === 'PAGE_CHANGED' &&
      !localAudioMode &&
      m.tabId === tabId &&
      m.videoKey !== (record?.videoKey || loadingVideoKey)
    )
      load();
    if (m.event === 'note-saved' && (m.recordId === record?.id || $('#note-scope').value === 'all'))
      hydrate().catch(error);
    if (
      ['audio-saved', 'audio-save-failed', 'audio-progress', 'history-deleted'].includes(m.event) &&
      $('#local-audio-library').open
    )
      refreshAudioLibrary().catch(error);
    if (m.event === 'asr-progress' && m.recordId === record?.id) {
      record.transcriptMeta.asrSegments = m.segments;
      renderCapture();
    }
    if (m.event === 'asr-translation-error' && m.recordId === record?.id)
      status(`原文已保存，自动翻译失败：${m.error}`, true);
    if (m.event === 'asr' && m.recordId === record?.id) {
      record = m.record;
      if (captureInfo) captureInfo.completed = m.completed;
      render();
      bindPlayer(true).catch(error);
    }
    if (m.event === 'asr-finished') {
      if (!captureInfo || captureInfo.recordId === m.recordId) {
        recording = false;
        captureInfo = null;
        renderCapture();
      }
      if (m.recordId === record?.id) {
        const gen = generation;
        rpc('GET_RECORD', { recordId: m.recordId })
          .then((r) => {
            if (gen === generation && r.id === record?.id) {
              record = r;
              render();
              bindPlayer(true).catch(error);
            }
          })
          .catch(error);
        status(
          m.error
            ? `音频识别结束，结果不完整：${m.error}`
            : m.canceled
              ? '转写已取消，完成的字幕已保留。'
              : '音频识别已完成。',
          !!m.error,
        );
      }
    }
  });
  settings = await rpc('GET_SETTINGS').catch(() => ({}));
  captureInfo = await rpc('CAPTURE_STATUS').catch(() => null);
  recording = !!captureInfo;
  renderCapture();
  load();
} else status('网页预览模式 · 点击「先体验示例」查看完整交互');

const copyAll = button('复制', () => copy(transcriptText()), 'transcript-quick-action');
copyAll.id = 'copy-transcript';
copyAll.title = '复制当前显示的全部字幕';
copyAll.setAttribute('aria-label', '复制当前显示的全部字幕');
$('#transcript-actions').append(copyAll);
function openSearch(open) {
  $('#transcript-search').hidden = !open;
  $('#toggle-search').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
  else {
    $('#search').value = '';
    listOffset = 0;
    renderSentences();
  }
}
$('#toggle-search').onclick = () => openSearch($('#transcript-search').hidden);
$('#close-search').onclick = () => openSearch(false);
$('#dismiss-status').onclick = () => ($('#status').hidden = true);
for (const dialog of $$('dialog'))
  new MutationObserver(syncKeyboard).observe(dialog, {
    attributes: true,
    attributeFilter: ['open'],
  });
$('.transcript-menu').addEventListener('click', (e) => {
  if (e.target?.closest?.('button')) $('.transcript-more').open = false;
});
document.addEventListener('click', (e) => {
  if (!e.target?.closest?.('.transcript-more')) $('.transcript-more').open = false;
});
let selectionContext = null,
  explanationContext = null;
const explanationSource = el('p');
explanationSource.id = 'explain-source';
$('#explain-dialog h2').after(explanationSource);
const selectionNote = button(
  '＋ 存笔记',
  async () => {
    const chosen = selectionContext;
    if (chosen?.recordId !== record?.id) return;
    const rows = record.sentences.filter((s) => chosen.ids.includes(s.id));
    if (!rows.length) return;
    const saved = await noteRpc('SAVE_NOTE', {
      note: {
        recordId: record.id,
        body: chosen.text,
        sourceText: chosen.text,
        timestamp: rows[0].start,
        end: rows.at(-1).end,
        sentenceIds: rows.map((s) => s.id),
      },
    });
    if (chosen.recordId === record?.id) {
      notes = [saved, ...notes.filter((n) => n.id !== saved.id)];
      renderNotes();
    }
    selectionNote.hidden = true;
    selectionButton.hidden = true;
    selectionMastered.hidden = true;
    toast('选中文字已保存');
  },
  'selection-note',
);
selectionNote.hidden = true;
selectionNote.onmousedown = (e) => e.preventDefault();
document.body.append(selectionNote);

const masteredButton = button(
  '已掌握',
  async () => {
    const chosen = explanationContext;
    if (chosen?.recordId === record?.id) {
      await focus.markMastered(chosen.text);
      $('#explain-dialog').close();
    }
  },
  'text-btn focus-mastered',
);
masteredButton.id = 'focus-mastered-word';
$('#explain-ask').after(masteredButton);
$('#explain-ask').onclick = () => {
  if (!explanationContext || explanationContext.recordId !== record?.id) return;
  const chosen = explanationContext;
  $('#explain-dialog').close();
  ask({ sentenceIds: chosen.ids });
  qaSelectedText = chosen.text;
  $('#question').value = '关于“' + chosen.text + '”，';
  renderQaContext();
  $('#question').focus();
};
const selectionButton = button(
  '✧ 解释选中内容',
  async () => {
    const chosen = selectionContext;
    explanationContext = chosen;
    if (!chosen || chosen.recordId !== record?.id) return;
    selectionButton.hidden = true;
    selectionMastered.hidden = true;
    selectionNote.hidden = true;
    const gen = generation;
    explanationSource.textContent = '优先读取本地解释；首次解释会调用模型。';
    $('#explain-selection').textContent = chosen.text;
    $('#explain-pronunciation').hidden = true;
    $('#explain-meaning').hidden = true;
    $('#explain-answer').textContent = '正在结合视频上下文解释…';
    $('#explain-answer-en').hidden = true;
    $('#explain-dialog').showModal();
    try {
      const result = await rpc('TASK', {
        recordId: chosen.recordId,
        capability: 'explain',
        args: {
          selectedText: chosen.text,
          selectedIds: chosen.ids,
          currentTime: time,
          question: chosen.text,
        },
      });
      if (gen !== generation) return;
      explanationSource.textContent = result.cached
        ? '已读取本地解释 · 未调用模型'
        : '本次由模型生成 · 已保存到本地';
      if (result.pronunciation) {
        $('#explain-pronunciation').textContent = `发音：${result.pronunciation}`;
        $('#explain-pronunciation').hidden = false;
      }
      if (result.meaning) {
        $('#explain-meaning').textContent = `词义：${result.meaning}`;
        $('#explain-meaning').hidden = false;
      }
      $('#explain-answer').textContent = result.answer;
      $('#explain-answer-en').textContent =
        result.answerEn ||
        'English explanation is unavailable. Please retry with a model that follows the bilingual format.';
      $('#explain-answer-en').hidden = false;
      await hydrate();
    } catch (e) {
      $('#explain-answer').textContent = e.message;
    }
  },
  'selection-explain',
);
const selectionMastered = button(
  '✓ 已掌握',
  async () => {
    const chosen = selectionContext;
    if (chosen?.recordId === record?.id) await focus.markMastered(chosen.text);
    selectionMastered.hidden = true;
    selectionButton.hidden = true;
    selectionNote.hidden = true;
  },
  'selection-mastered',
);
selectionMastered.hidden = true;
selectionMastered.onmousedown = (e) => e.preventDefault();
document.body.append(selectionMastered);
selectionButton.hidden = true;
selectionButton.onmousedown = (e) => e.preventDefault();
document.body.append(selectionButton);
const selectionToolbar = el('div', 'selection-toolbar');
selectionToolbar.setAttribute('role', 'toolbar');
selectionToolbar.setAttribute('aria-label', '选中文字操作');
selectionToolbar.append(selectionButton, selectionMastered, selectionNote);
document.body.append(selectionToolbar);
document.addEventListener('mouseup', () => {
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !record) {
    selectionButton.hidden = true;
    selectionMastered.hidden = true;
    selectionNote.hidden = true;
    return;
  }
  const range = selection.getRangeAt(0),
    rows = $$('#sentences .sentence').filter((row) => range.intersectsNode(row));
  if (
    !rows.length ||
    !rows.some((row) => row.contains(selection.anchorNode)) ||
    !rows.some((row) => row.contains(selection.focusNode))
  ) {
    selectionButton.hidden = true;
    selectionMastered.hidden = true;
    selectionNote.hidden = true;
    return;
  }
  const text = selection.toString().trim();
  if (!text || text.length > 12000) {
    selectionButton.hidden = true;
    selectionMastered.hidden = true;
    selectionNote.hidden = true;
    return;
  }
  pauseFollow();
  selectionContext = {
    recordId: record.id,
    text,
    ids: [...new Set(rows.map((row) => row.dataset.id))],
  };
  const box = range.getBoundingClientRect();
  selectionNote.hidden = false;
  selectionButton.hidden = false;
  selectionMastered.hidden = text.length > 160;
  selectionToolbar.style.left = `${Math.max(8, Math.min(innerWidth - selectionToolbar.offsetWidth - 8, box.left))}px`;
  selectionToolbar.style.top = `${Math.max(8, Math.min(innerHeight - selectionToolbar.offsetHeight - 8, box.bottom + 6))}px`;
});
document.addEventListener(
  'scroll',
  () => {
    selectionButton.hidden = true;
    selectionMastered.hidden = true;
    selectionNote.hidden = true;
  },
  true,
);
$('#close-explain').onclick = () => $('#explain-dialog').close();

const detailPositions = new Map();
let quoteTranslationRequest = null;
function needsQuoteReview() {
  const q = record?.analysis?.quotes || [];
  return (
    !!record?.analysisChunks &&
    q.length > 1 &&
    record.analysis.quoteReviewSignature !==
      JSON.stringify([1, q.map((x) => [x.sentenceId, x.quote])])
  );
}
async function ensureQuoteTranslations() {
  const id = record?.id,
    gen = generation;
  if (!id) return;
  if (quoteTranslationRequest?.id === id) return quoteTranslationRequest.promise;
  const promise = rpc('TASK', { recordId: id, capability: 'quoteTranslation', args: {} })
    .then((result) => {
      if (gen !== generation || record?.id !== id) return;
      const changed =
        JSON.stringify((record.analysis?.quotes || []).map((q) => [q.sentenceId, q.quote])) !==
        JSON.stringify((result.quotes || []).map((q) => [q.sentenceId, q.quote]));
      if (changed) record.analysis.quotes = result.quotes;
      else
        for (const q of record.analysis.quotes || []) {
          const next = result.quotes?.find(
            (x) => x.sentenceId === q.sentenceId && x.quote === q.quote,
          );
          if (next) Object.assign(q, next);
        }
      record.analysis.quoteReviewSignature = result.quoteReviewSignature;
      if (changed) renderOverview();
    })
    .finally(() => {
      if (quoteTranslationRequest?.promise === promise) quoteTranslationRequest = null;
    });
  quoteTranslationRequest = { id, promise };
  return promise;
}
function renderDetailBrowser(root, items, isQuote) {
  const kind = isQuote ? 'quote' : 'explanation',
    label = isQuote ? '金句' : '精讲';
  if (!items.length) {
    root.append(el('p', 'hint', isQuote ? '暂无精选金句。' : '暂无分段精讲。'));
    return;
  }
  const box = el('section', `${kind}-browser`),
    strip = el('div', `${kind}-strip detail-strip`),
    card = el('article', `card ${kind}-card`);
  strip.style.gap = `${Math.min(2, 40 / items.length)}px`;
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', `${label}导航`);
  let index = -1;
  const show = (i) => {
    i = Math.max(0, Math.min(items.length - 1, i));
    if (i === index) return;
    index = i;
    detailPositions.set(record?.id + ':' + kind, i);
    const q = items[index];
    [...strip.children].forEach((b, j) => b.setAttribute('aria-pressed', String(j === index)));
    card.replaceChildren();
    card.append(button(formatTime(q.start), () => seekPlay(q.start)));
    if (isQuote) {
      card.append(el('blockquote', '', q.quote));
      const meaning = el('p', 'quote-translation');
      meaning.lang = 'zh-CN';
      card.append(meaning);
      const update = () => {
        const translated = quoteTranslation(q, record?.sentences || []);
        meaning.textContent = translated || '中文意思暂未生成。';
        return !!translated;
      };
      if (!update()) {
        const translate = button('生成中文意思', async () => {
          translate.disabled = true;
          meaning.textContent = '正在翻译…';
          try {
            await ensureQuoteTranslations();
            update();
            translate.hidden = !!quoteTranslation(q, record?.sentences || []);
          } catch (e) {
            meaning.textContent = '中文翻译未完成，可重试。';
            throw e;
          } finally {
            translate.disabled = false;
          }
        });
        meaning.after(translate);
      }

      if (q.reason) {
        const detail = el('details', 'quote-reason');
        detail.open = true;
        detail.append(el('summary', '', '入选理由'), el('p', '', q.reason));
        card.append(detail);
      }
    } else
      card.append(
        button(q.title, () => seekPlay(q.start), 'overview-title'),
        el('p', 'explanation-body', q.body || q.summary || ''),
      );
    const text = () =>
      isQuote
        ? [q.quote, quoteTranslation(q, record?.sentences || [])].filter(Boolean).join('\n')
        : `${q.title}\n${q.body || q.summary || ''}`;
    const actions = el('div', 'row');
    actions.append(
      button('复制', () => copy(text())),
      button('提问', () => ask(q)),
      button('＋ 笔记', () =>
        editNote(
          {
            ...q,
            rawText: isQuote ? q.quote : q.body || q.summary,
            id: q.fromSentenceId || q.sentenceId,
          },
          null,
          text(),
        ),
      ),
    );
    card.append(actions);
  };
  for (const [i, q] of items.entries()) {
    const b = button('', () => show(i), `${kind}-mark detail-mark`);
    b.title = `${formatTime(q.start)} ${q.quote || q.title}`;
    b.setAttribute('aria-label', `${label} ${i + 1}：${q.quote || q.title}`);
    b.onmouseenter = () => show(i);
    b.onfocus = () => show(i);
    b.onkeydown = (e) => {
      let next;
      if (e.key === 'ArrowRight') next = Math.min(items.length - 1, i + 1);
      if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = items.length - 1;
      if (next !== undefined) {
        e.preventDefault();
        strip.children[next].focus();
      }
    };
    strip.append(b);
  }
  box.append(strip, card);
  root.append(box);
  show(detailPositions.get(record?.id + ':' + kind) || 0);
  if (isQuote) {
    const details = root.closest('.overview-extra');
    if (details)
      details.addEventListener('toggle', async () => {
        if (
          !details.open ||
          (!items.some((q) => !quoteTranslation(q, record?.sentences || [])) &&
            !needsQuoteReview()) ||
          record?.videoInfo.platform === 'demo'
        )
          return;
        const reviewing = needsQuoteReview() ? el('p', 'hint', '正在核对精选内容…') : null;
        if (reviewing) box.prepend(reviewing);
        try {
          await ensureQuoteTranslations();
          if (box.isConnected) {
            const selected = index;
            index = -1;
            show(selected);
          }
        } catch (e) {
          if (box.isConnected) toast('金句整理未完成，可重新展开重试。');
        } finally {
          reviewing?.remove();
        }
      });
  }
}

// Low-frequency tools live in menus; each dialog has one clear purpose.
function closeTools() {
  $('.transcript-more').open = false;
}
$('#subtitle-settings').onclick = () => {
  closeTools();
  $('#subtitle-settings-dialog').showModal();
};
$('#open-focus-settings').onclick = () => {
  $('#subtitle-settings-dialog').close();
  $('#focus-settings').click();
};
$('#open-import').onclick = () => {
  closeTools();
  $('#import-dialog').showModal();
};
$('#first-subtitle').onclick = () => {
  closeTools();
  pauseFollow();
  openSearch(false);
  listOffset = 0;
  limit = 70;
  renderSentences();
  const revision = locateRevision;
  window.scrollTo({ top: 0, behavior: 'instant' });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (
        revision === locateRevision &&
        !followPlayback &&
        $('#transcript').classList.contains('active')
      )
        window.scrollTo({ top: 0, behavior: 'instant' });
    }),
  );
};
$('#last-subtitle').onclick = () => {
  if (!record?.sentences?.length) return;
  closeTools();
  pauseFollow();
  openSearch(false);
  listOffset = Math.max(0, record.sentences.length - 70);
  limit = 70;
  renderSentences();
  const revision = locateRevision;
  const align = () => {
    if (
      revision !== locateRevision ||
      followPlayback ||
      !$('#transcript').classList.contains('active')
    )
      return;
    const last = $('#sentences .sentence:last-child');
    if (!last) return;
    window.scrollBy({
      top: last.getBoundingClientRect().bottom - $('footer').getBoundingClientRect().top + 12,
      behavior: 'instant',
    });
  };
  align();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      align();
    }),
  );
};
for (const id of ['open-replay', 'export', 'refresh', 'copy-transcript'])
  $('#' + id).addEventListener('click', closeTools);
document.addEventListener('pointerdown', (e) => {
  if (!e.target?.closest?.('.transcript-more')) closeTools();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTools();
});
function updateTranslationPrompt() {
  const missing = record?.sentences.some((s) => !s.translation);
  $('#translation-needed').hidden = (mode === 'original' && !focus.wantsTranslation) || !missing;
  $('#translation-needed span').textContent = focus.wantsTranslation
    ? busy
      ? '正在优先翻译播放位置附近，并继续补齐全片。'
      : '双语译文尚未补齐，已生成部分会保存在本机。'
    : '当前字幕还没有完整译文。';
  $('#translate').disabled = busy || backgroundBusy || recording;
  $$('#asr-segment-list button').forEach((control) => {
    control.disabled = busy || backgroundBusy || recording;
  });
  $('#retry-translation').disabled = busy || backgroundBusy || recording;
  $('#deduplicate-asr').disabled = busy || backgroundBusy || recording;
  $('#translate').textContent = busy ? '正在翻译…' : replayArmed ? '翻译选中字幕' : '补齐全片译文';
}
function replayBounds() {
  const list = record?.sentences || [];
  if (replaySelection?.recordId === record?.id) {
    const from = list.findIndex((s) => s.id === replaySelection.from),
      to = list.findIndex((s) => s.id === replaySelection.to);
    if (from >= 0 && to >= from) return { from, to };
  }
  const i = list.indexOf(current());
  return i >= 0 ? { from: i, to: i } : null;
}
function selectReplaySentence(sentence) {
  replayViewAnchor = null;
  replaySelection =
    sentence && record ? { recordId: record.id, from: sentence.id, to: sentence.id } : null;
  replayArmed = !!replaySelection;
  updateReplayScope();
}
function expandReplay(delta) {
  requireRecord();
  const gen = generation,
    recordId = record.id;
  replayEditing++;
  const work = replayEdits
    .then(async () => {
      if (gen !== generation || recordId !== record?.id) return;
      if (ext && record.videoInfo.platform !== 'demo') {
        await rpc('PLAYER_COMMAND', {
          tabId,
          command: { action: 'pause', videoKey: record.videoKey },
        });
        if (gen !== generation || recordId !== record?.id) return;
        const state = await rpc('PLAYER_COMMAND', {
          tabId,
          command: { action: 'state', videoKey: record.videoKey },
        });
        if (gen !== generation || recordId !== record?.id) return;
        if (state && Number.isFinite(state.time)) receivePlayerState({ ...state, tabId });
      }
      $('#stop').hidden = true;
      const bounds = replayBounds();
      if (!bounds) return;
      const list = record.sentences,
        from = delta < 0 ? Math.max(0, bounds.from - 1) : bounds.from,
        to = delta > 0 ? Math.min(list.length - 1, bounds.to + 1) : bounds.to;
      replaySelection = { recordId: record.id, from: list[from].id, to: list[to].id };
      replayArmed = true;
      pauseFollow();
      updateReplayScope();
      // Center the paused playback sentence once. Further expansion changes only
      // the selection; offscreen selected sentences appear when the user scrolls.
      if (!replayViewAnchor || replayViewAnchor.recordId !== record.id) {
        const sentence = current();
        if (!sentence) return;
        const anchor = { recordId: record.id, id: sentence.id };
        replayViewAnchor = anchor;
        if (!$$('#sentences .sentence').some((e) => e.dataset.id === anchor.id)) {
          listOffset = Math.max(0, list.indexOf(sentence) - 15);
          limit = 70;
          renderSentences();
        }
        const revision = locateRevision;
        const align = () => {
          if (
            replayViewAnchor !== anchor ||
            gen !== generation ||
            revision !== locateRevision ||
            followPlayback ||
            !$('#transcript').classList.contains('active') ||
            $$('dialog[open]').length
          )
            return;
          const node = $$('#sentences .sentence').find((e) => e.dataset.id === anchor.id);
          if (!node) return;
          const box = node.getBoundingClientRect(),
            top = $('.tabs').getBoundingClientRect().bottom,
            bottom = $('footer').getBoundingClientRect().top;
          window.scrollBy({
            top: box.top - (top + Math.max(8, (bottom - top - box.height) / 2)),
            behavior: 'instant',
          });
        };
        align();
        requestAnimationFrame(() => requestAnimationFrame(align));
      }
    })
    .finally(() => {
      replayEditing--;
    });
  replayEdits = work.catch(() => {});
  return work;
}
function keyboardConfig() {
  return {
    keyboardEnabled:
      !!record?.sentences.length &&
      $('#transcript').classList.contains('active') &&
      !$$('dialog[open]').length,
    replayArmed,
  };
}
function syncKeyboard() {
  if (!ext || !tabId || !record || record.videoInfo.platform === 'demo') return;
  const config = keyboardConfig(),
    value = JSON.stringify([tabId, record.videoKey, config]);
  if (value === lastKeyboardState) return;
  lastKeyboardState = value;
  rpc('PLAYER_COMMAND', {
    tabId,
    command: { action: 'keyboard', videoKey: record.videoKey, ...config },
  }).catch(() => {
    if (lastKeyboardState === value) lastKeyboardState = '';
  });
}
async function seekByArrow(direction) {
  requireRecord();
  replayViewAnchor = null;
  replaySelection = null;
  replayArmed = false;
  updateReplayScope();
  if (record.videoInfo.platform === 'demo') return;
  const id = record.id,
    gen = generation,
    state = await rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: 'state', videoKey: record.videoKey },
    });
  if (id !== record?.id || gen !== generation) return;
  await rpc('PLAYER_COMMAND', {
    tabId,
    command: {
      action: 'seek',
      videoKey: record.videoKey,
      time: Math.max(
        0,
        Math.min(
          Number.isFinite(state.duration) ? state.duration : Infinity,
          state.time + direction * 5,
        ),
      ),
    },
  });
  resumeFollow();
}
function panelArrowKey(key) {
  const direction = key === 'ArrowLeft' ? -1 : 1;
  if (panelArrow?.key === key && performance.now() - panelArrow.at <= 350) {
    clearTimeout(panelArrow.timer);
    panelArrow = null;
    expandReplay(direction).catch(error);
    return;
  }
  if (panelArrow) {
    clearTimeout(panelArrow.timer);
    seekByArrow(panelArrow.direction).catch(error);
  }
  const pending = { key, direction, generation, at: performance.now() };
  panelArrow = pending;
  pending.timer = setTimeout(() => {
    if (panelArrow !== pending) return;
    panelArrow = null;
    if (generation === pending.generation) seekByArrow(direction).catch(error);
  }, 350);
}
function spacePlayback() {
  const gen = generation,
    id = record?.id;
  const work = spaceActions.then(async () => {
    await replayEdits;
    if (gen !== generation || id !== record?.id) return;
    requireRecord();
    if (replayArmed) {
      await $('#replay').onclick();
      return;
    }
    if (record.videoInfo.platform === 'demo') return;
    const state = await rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: 'state', videoKey: record.videoKey },
    });
    if (gen !== generation || id !== record?.id) return;
    if (smart) {
      smart = false;
      lastSmartRate = null;
      $('#smart').textContent = '智能速度：关闭';
      await rpc('PLAYER_COMMAND', {
        tabId,
        command: { action: 'rate', rate: normalRate, videoKey: record.videoKey },
      });
    }
    // Exiting a replay continues at the live position without seeking back to its start.
    await rpc('PLAYER_COMMAND', {
      tabId,
      command: { action: state?.session ? 'play' : 'toggle', videoKey: record.videoKey },
    });
    replaySelection = null;
    replayArmed = false;
    $('#stop').hidden = true;
    resumeFollow();
    updateReplayScope();
  });
  spaceActions = work.catch(() => {});
  return work;
}
function replayTarget() {
  const b = replayBounds();
  if (!b) return null;
  const list = record.sentences;
  return {
    start: list[b.from].start,
    end: Math.min(
      Math.max(...list.slice(b.from, b.to + 1).map((s) => s.end)),
      list[b.to + 1]?.start ?? Infinity,
    ),
    strict: true,
  };
}
function updateReplayScope() {
  syncKeyboard();
  const bounds = replayBounds(),
    count = bounds ? bounds.to - bounds.from + 1 : 1,
    range = replayTarget();
  $('#replay').textContent = `↺ 复听 ${count} 句`;
  $('#previous').disabled = !bounds || bounds.from === 0;
  $('#next').disabled = !bounds || bounds.to === record.sentences.length - 1;
  const hint = $('#replay-range-hint'),
    state = $('#play-state').textContent;
  hint.hidden = !record?.sentences.length;
  const replaying = !$('#stop').hidden && !smart;
  const shownRange = replaying ? playingRange || range : range;
  const phase =
    state === '广告播放中'
      ? '广告播放中'
      : replayArmed
        ? '已选句'
        : replaying
          ? '正在复听'
          : state === '已暂停'
            ? '已暂停'
            : '正常播放';
  const action = replayArmed
    ? '空格开始复听'
    : replaying
      ? '空格退出复听，继续播放'
      : state === '已暂停'
        ? '空格播放'
        : '空格暂停';
  hint.textContent = `${phase}${replayArmed || replaying ? ` · ${formatTime(shownRange?.start || 0)}–${formatTime(shownRange?.end || 0)}` : ''} · ${action}`;
  hint.title = hint.textContent;
  $('#replay').title = '点击复听；左右按钮或双按方向键可增加句子';

  const selected = new Set(
    bounds && replaySelection
      ? record.sentences.slice(bounds.from, bounds.to + 1).map((s) => s.id)
      : [],
  );
  for (const row of $$('#sentences .sentence')) {
    row.classList.toggle('replay-selected', selected.has(row.dataset.id));
  }
}
function updateLocateControl() {
  const node = $$('.sentence').find((e) => e.dataset.id === current()?.id),
    box = node?.getBoundingClientRect();
  $('#subtitle-navigation').hidden = $('#locate').hidden =
    !record?.sentences.length ||
    !$('#transcript').classList.contains('active') ||
    (followPlayback && !$('#search').value) ||
    (!!box &&
      !$('#search').value &&
      box.top > $('.tabs').getBoundingClientRect().bottom &&
      box.bottom < $('footer').getBoundingClientRect().top);
}
let userScrollUntil = 0,
  pagingBusy = false,
  lastPageScroll = 0,
  lastTouchY = null;
window.addEventListener(
  'touchstart',
  (e) => {
    lastTouchY = e.touches[0]?.clientY ?? null;
  },
  { passive: true },
);
function markBrowse(e) {
  if (e.target.closest?.('dialog,.transcript-menu,input,textarea,select')) return;
  userScrollUntil = Date.now() + 800;
  const touchY = e.touches?.[0]?.clientY,
    touchDelta = touchY != null && lastTouchY != null ? lastTouchY - touchY : 0;
  if (touchY != null) lastTouchY = touchY;
  const direction =
    e.deltaY ||
    touchDelta ||
    (['PageUp', 'Home', 'ArrowUp'].includes(e.key)
      ? -1
      : ['PageDown', 'End', 'ArrowDown'].includes(e.key)
        ? 1
        : 0);
  if (direction) requestAnimationFrame(() => maybeExtendSentences(direction));
}
window.addEventListener('wheel', markBrowse, { passive: true });
window.addEventListener('touchmove', markBrowse, { passive: true });
window.addEventListener('keydown', (e) => {
  if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) markBrowse(e);
});
window.addEventListener(
  'scroll',
  () => {
    updateLocateControl();
    const direction = scrollY - lastPageScroll;
    lastPageScroll = scrollY;
    maybeExtendSentences(direction);
  },
  { passive: true },
);
function maybeExtendSentences(direction) {
  if (
    pagingBusy ||
    !direction ||
    Date.now() > userScrollUntil ||
    followPlayback ||
    !record ||
    !$('#transcript').classList.contains('active') ||
    $$('dialog[open]').length ||
    getSelection()?.toString()
  )
    return;
  const rows = $$('#sentences .sentence'),
    first = rows[0],
    last = rows.at(-1);
  if (!first || !last) return;
  if (
    direction > 0 &&
    $('#sentences').dataset.hasAfter === 'true' &&
    last.getBoundingClientRect().bottom < $('footer').getBoundingClientRect().top + 180
  )
    extendSentences(1);
  else if (
    direction < 0 &&
    listOffset > 0 &&
    first.getBoundingClientRect().top > $('.tabs').getBoundingClientRect().bottom - 180
  )
    extendSentences(-1);
}
function extendSentences(direction) {
  if (pagingBusy) return;
  pagingBusy = true;
  userScrollUntil = 0;
  const rows = $$('#sentences .sentence'),
    anchor =
      direction > 0
        ? rows.find(
            (e, i) =>
              i >= Math.min(70, rows.length - 1) &&
              e.getBoundingClientRect().bottom > $('.tabs').getBoundingClientRect().bottom,
          ) || rows.at(-1)
        : rows[0],
    id = anchor?.dataset.id,
    top = anchor?.getBoundingClientRect().top;
  if (direction > 0) {
    if (limit < 210) limit += 70;
    else listOffset += 70;
  } else {
    const added = Math.min(70, listOffset);
    listOffset -= added;
    limit = Math.min(210, limit + added);
  }
  renderSentences();
  const restored = $$('#sentences .sentence').find((e) => e.dataset.id === id);
  if (restored && Number.isFinite(top))
    window.scrollBy({ top: restored.getBoundingClientRect().top - top, behavior: 'instant' });
  lastPageScroll = scrollY;
  requestAnimationFrame(() => {
    pagingBusy = false;
  });
}

async function quickNote() {
  requireRecord();
  if (!ext || record.videoInfo.platform === 'demo')
    return editNote(current(), null, current()?.rawText || '');
  const result = await rpc('QUICK_NOTE', { tabId });
  await hydrate();
  toast(result.warning || '笔记已自动保存');
}

for (const id of ['subtitle-settings-dialog', 'import-dialog', 'export-dialog'])
  $('#' + id).addEventListener('close', () =>
    requestAnimationFrame(() => {
      if (
        followPlayback &&
        $('#transcript').classList.contains('active') &&
        !$$('dialog[open]').length &&
        !$('#search').value &&
        !getSelection()?.toString()
      )
        locate();
    }),
  );

function searchText(s) {
  return subtitleSearchText(s, mode);
}

function markSearch() {
  const q = $('#search').value.trim();
  if (!q) return;
  for (const root of $$('#sentences .sentence-body')) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue,
        ranges = literalMatches(text, q);
      if (!ranges.length) continue;
      const fragment = document.createDocumentFragment();
      let pos = 0;
      for (const range of ranges) {
        fragment.append(
          document.createTextNode(text.slice(pos, range.start)),
          el('mark', 'search-highlight', text.slice(range.start, range.end)),
        );
        pos = range.end;
      }
      fragment.append(document.createTextNode(text.slice(pos)));
      node.replaceWith(fragment);
    }
  }
}
function updateSearchControls(list) {
  const q = $('#search').value.trim();
  searchIds = q
    ? list.flatMap((s, row) =>
        literalMatches(searchText(s), q).map((range, occurrence) => ({
          id: s.id,
          row,
          occurrence,
        })),
      )
    : [];
  searchIndex = Math.min(searchIndex, Math.max(0, searchIds.length - 1));
  $('#search-count').textContent = q
    ? searchIds.length
      ? `${searchIndex + 1}/${searchIds.length} 处`
      : '0 处'
    : '';
  for (const id of ['search-prev', 'search-next']) $('#' + id).disabled = !searchIds.length;
  markSearch();
}
function moveSearch(delta) {
  if (!searchIds.length) return;
  pauseFollow();
  searchIndex = (searchIndex + delta + searchIds.length) % searchIds.length;
  const match = searchIds[searchIndex];
  listOffset = Math.floor(match.row / 70) * 70;
  limit = 70;
  renderSentences();
  const node = $$('#sentences .sentence').find((n) => n.dataset.id === match.id);
  node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  $$('.search-target').forEach((n) => n.classList.remove('search-target'));
  node?.classList.add('search-target');
  node?.querySelectorAll('mark')[match.occurrence]?.classList.add('current');
}
$('#search-prev').onclick = () => moveSearch(-1);
$('#search-next').onclick = () => moveSearch(1);
$('#search').addEventListener('input', () => {
  searchIndex = 0;
  renderSentences();
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    moveSearch(e.shiftKey ? -1 : 1);
  }
});
function saveReading() {
  if (!ext || !chrome.storage?.local?.set || !record || record.videoInfo.platform === 'demo')
    return;
  const id = record.videoKey;
  const anchor = $$('#sentences .sentence').find(
    (n) => n.getBoundingClientRect().bottom > $('.tabs').getBoundingClientRect().bottom,
  );
  const state = {
    recordId: record.id,
    mode,
    listOffset,
    limit,
    anchorId: anchor?.dataset.id,
    anchorTop: anchor?.getBoundingClientRect().top,
    scrollY: $('#transcript').classList.contains('active')
      ? window.scrollY
      : viewScroll.transcript || 0,
    followPlayback,
  };
  chrome.storage.local.set({ ['reading:' + id]: state }).catch(() => {});
}
async function restoreReading(gen) {
  if (!ext || !chrome.storage?.local?.get || !record) return;
  const id = record.id,
    key = 'reading:' + record.videoKey;
  const state = (await chrome.storage.local.get(key))[key];
  if (gen !== generation || record?.id !== id) return;
  if (state?.recordId === id) {
    mode = ['original', 'bilingual', 'translated'].includes(state.mode) ? state.mode : 'original';
    listOffset = Math.max(0, Number(state.listOffset) || 0);
    limit = Math.max(70, Math.min(210, Number(state.limit) || 70));
    followPlayback = false;
    viewScroll.transcript = Math.max(0, Number(state.scrollY) || 0);
    renderSentences();
    renderNotes();
    window.scrollTo({ top: viewScroll.transcript, behavior: 'instant' });
    const anchor = $$('#sentences .sentence').find((n) => n.dataset.id === state.anchorId);
    if (anchor && Number.isFinite(state.anchorTop))
      window.scrollBy({
        top: anchor.getBoundingClientRect().top - state.anchorTop,
        behavior: 'instant',
      });
  }
  syncModeControls();
  maybeTranslateVideo();
}
window.addEventListener(
  'scroll',
  () => {
    clearTimeout(readingTimer);
    readingTimer = setTimeout(saveReading, 300);
  },
  { passive: true },
);
$('#translate-notes').onclick = guard(async () => {
  const gen = generation;
  const top = $('.tabs').getBoundingClientRect().bottom,
    bottom = $('footer').getBoundingClientRect().top;
  const visible = $$('#notes-list [data-note-id]')
    .filter((n) => {
      const b = n.getBoundingClientRect();
      return b.bottom > top && b.top < bottom;
    })
    .map((n) => notes.find((x) => x.id === n.dataset.noteId))
    .filter(Boolean);
  const missing = visible.filter(
    (n) => n.translations?.[settings.targetLanguage || '简体中文']?.source !== n.body,
  );
  if (!missing.length) {
    toast('当前笔记已有译文');
    return;
  }
  $('#translate-notes').disabled = true;
  try {
    for (let i = 0; i < missing.length; i += 3) {
      const batch = missing.slice(i, i + 3);
      for (const id of new Set(batch.map((n) => n.recordId))) {
        const result = await rpc('TRANSLATE_NOTES', {
          recordId: id,
          ids: batch.filter((n) => n.recordId === id).map((n) => n.id),
        });
        if (gen !== generation) return;
        notes = notes.map((n) => result.find((x) => x.id === n.id) || n);
      }
      renderNotes();
    }
    changeMode('bilingual');
    toast('笔记译文已保存');
  } finally {
    $('#translate-notes').disabled = false;
  }
});

function translationSignature() {
  return JSON.stringify([
    settings.provider,
    settings.baseUrl,
    settings.models?.translation || settings.model,
    settings.targetLanguage,
    settings.prompts?.translation || '',
    ...(record?.videoInfo?.platform === 'migu' &&
    record.transcriptMeta?.source?.startsWith('whisper') &&
    /中文|Chinese|zh/i.test(settings.targetLanguage || '简体中文')
      ? ['source-only-v2']
      : []),
  ]);
}
function applyTranslationDisplay() {
  if (!record?.tasks?.translation?.signature || !settings.targetLanguage) return;
  const sig = translationSignature();
  if (record.tasks.translation.signature === sig) return;
  const cache = record.translationCaches?.[sig] || {};
  for (const s of record.sentences) {
    delete s.translation;
    if (cache[s.id]?.source === s.rawText) s.translation = cache[s.id].text;
  }
}

async function refreshAudioLibrary() {
  if (!ext) return;
  const list = $('#audio-library-list');
  list.textContent = '正在读取本地音频…';
  const entries = await rpc('AUDIO_LIBRARY');
  list.replaceChildren();
  if (!entries.length) {
    list.textContent = '尚无学习记录。读取视频后，这里会保存视频链接与可用的本地音频。';
    return;
  }
  for (const entry of entries) {
    const box = document.createElement('section'),
      title = document.createElement('h3');
    title.textContent = entry.title;
    const info = document.createElement('p'),
      summary = audioCoverage(entry.clips);
    const complete =
      entry.duration > 0 &&
      summary.ranges.some((range) => range.start <= 0.5 && range.end >= entry.duration - 1);
    info.textContent = entry.clips.length
      ? `已保存 ${formatTime(summary.seconds)} / ${formatTime(entry.duration || summary.seconds)} · ${(summary.bytes / 1048576).toFixed(1)} MB · ${entry.clips.length} 段`
      : '音频尚未保存';
    box.append(title, info);
    if (entry.url)
      box.append(
        button('打开视频链接', () => chrome.tabs.create({ url: entry.url })),
        button('复制视频链接', () => copy(entry.url)),
      );
    if (entry.clips.length) box.append(button('打开本地学习', () => openLocalAudio(entry)));
    const save = button(complete ? '音频已完整保存' : '保存完整音频', async () => {
      await rpc('SAVE_VIDEO_AUDIO', {
        recordId: entry.recordId,
        ...(record?.videoKey === entry.videoKey && !localAudioMode && tabId ? { tabId } : {}),
        retry: true,
      });
      await refreshAudioLibrary();
    });
    save.disabled = complete || entry.audioStatus?.state === 'saving';
    save.title =
      entry.platform === 'migu'
        ? '咪咕会从视频开头自动播放并实时采集完整音频，耗时约等于视频长度。'
        : '优先在后台下载独立音轨；不可下载时从开头自动播放并采集。';
    box.append(save);
    box.append(
      button(
        '删除记录',
        async () => {
          if (
            !confirm(
              `删除「${entry.title}」的学习记录？对应字幕、译文、重点词、笔记、问答和本地音频都会永久删除；共享模型缓存也会清空。`,
            )
          )
            return;
          const deletingCurrent = record?.videoKey === entry.videoKey;
          if (deletingCurrent) await leaveVideo();
          await rpc('DELETE_VIDEO_HISTORY', { videoKey: entry.videoKey });
          if (deletingCurrent) {
            generation++;
            localPlayer.dispose();
            localAudioMode = false;
            $('#audio-video-mode').hidden = true;
            record = null;
            tabId = null;
            notes = [];
            chats = [];
            active = -1;
            render();
          }
          await refreshAudioLibrary();
          toast('学习记录已删除');
        },
        'text-btn history-delete',
      ),
    );
    if (entry.audioStatus?.state === 'saving') {
      box.append(
        el(
          'p',
          'hint',
          `${entry.audioStatus.method === 'playback' ? '正在实时播放并采集' : '正在后台下载'}音频 · ${entry.audioStatus.seconds != null ? `${formatTime(entry.audioStatus.seconds)} / ${formatTime(entry.audioStatus.totalSeconds || entry.duration)} · ` : ''}${(entry.audioStatus.bytes / 1048576).toFixed(1)} MB${entry.audioStatus.total ? ` / ${(entry.audioStatus.total / 1048576).toFixed(1)} MB` : ''}`,
        ),
      );
      box.append(
        button('取消保存', async () => {
          await rpc('CANCEL', {
            recordId: `audio:${entry.videoKey}`,
            capability: 'audio-download',
          });
          await refreshAudioLibrary();
        }),
      );
    }
    if (['failed', 'unavailable'].includes(entry.audioStatus?.state))
      box.append(el('p', 'hint', `后台保存未完成：${entry.audioStatus.error}`));
    if (!entry.clips.length) {
      list.append(box);
      continue;
    }
    const details = document.createElement('details'),
      heading = document.createElement('summary');
    heading.textContent = '音频片段、导出与重试';
    details.append(heading);
    for (const clip of entry.clips) {
      const row = document.createElement('div');
      row.className = 'local-audio-clip';
      const label = document.createElement('span');
      label.textContent = `${formatTime(clip.start)}–${formatTime(clip.end)}`;
      row.append(
        label,
        button('播放', async () => {
          await openLocalAudio(entry);
          await seekPlay(clip.start);
        }),
        button('导出', async () => {
          const data = await getAudio(clip.id);
          if (!data?.blob) throw new Error('音频已删除');
          const url = URL.createObjectURL(data.blob),
            a = document.createElement('a');
          a.href = url;
          a.download = `CueMind-${Math.floor(clip.start)}-${Math.ceil(clip.end)}.${clip.mimeType?.includes('mp4') ? 'm4a' : 'webm'}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }),
        ...(clip.end - clip.start <= 180 && clip.bytes <= 24 * 1048576
          ? [
              button('识别并补译', async () => {
                if (busy || backgroundBusy || recording) throw new Error('请等待当前任务完成');
                await openLocalAudio(entry);
                const id = record.id,
                  gen = generation;
                busy = true;
                try {
                  status('正在读取已保存音频并识别…');
                  const data = await getAudio(clip.id);
                  if (!data?.blob) throw new Error('音频已删除');
                  const audio = await prepareSpeechAudio(
                    data.blob,
                    speechSettings(settings, record.videoInfo.platform),
                  );
                  const updated = await rpc('RETRY_SAVED_AUDIO', {
                    recordId: id,
                    clipId: clip.id,
                    dataUrl: await dataURL(audio),
                  });
                  if (gen !== generation) return;
                  record = updated;
                  render();
                  status('原文已保存');
                } finally {
                  busy = false;
                }
                if (gen === generation && modelReady()) {
                  const ids = record.sentences
                    .filter((s) => s.start < clip.end && s.end > clip.start && !s.translation)
                    .map((s) => s.id);
                  for (let i = 0; i < ids.length; i += 70)
                    await task('translation', { selectedIds: ids.slice(i, i + 70) });
                } else if (gen === generation) status('原文已保存；配置文本模型后可补齐译文。');
              }),
            ]
          : []),
      );
      details.append(row);
    }
    box.append(
      details,
      button('删除此视频本地音频', async () => {
        if (recording) throw new Error('请先结束音频采集');
        if (entry.audioStatus?.state === 'saving') throw new Error('请先取消后台音频保存');
        if (!confirm('删除此视频已保存的音频？字幕、译文和重点词会保留。删除后需要重新采集音频。'))
          return;
        if (localAudioMode && record?.videoKey === entry.videoKey) localPlayer.dispose();
        await deleteAudio(entry.videoKey);
        if (localAudioMode && record?.videoKey === entry.videoKey)
          localPlayer.setClips([], entry.videoKey);
        await refreshAudioLibrary();
      }),
    );
    list.append(box);
  }
}
async function openLocalAudio(entry) {
  if (busy || backgroundBusy || recording) throw new Error('请先结束当前任务再切换到本地学习');
  await leaveVideo();
  const next = await rpc('GET_RECORD', { recordId: entry.recordId });
  const clips = await audioClips(next.videoKey);
  if (!clips.length) throw new Error('本地音频已删除');
  generation++;
  record = next;
  tabId = null;
  localAudioMode = true;
  time = clips[0].start;
  active = -1;
  listOffset = 0;
  limit = 70;
  replaySelection = null;
  replayArmed = false;
  playingRange = null;
  localPlayer.setClips(clips, record.videoKey);
  $('#audio-video-mode').hidden = false;
  mode = 'bilingual';
  resumeFollow();
  await hydrate();
  render();
  await bindPlayer();
  status('本地音频学习 · 无需打开原视频。识别和补译仍需联网。');
}
$('#audio-library-refresh').onclick = guard(refreshAudioLibrary);
$('#local-audio-library').addEventListener('toggle', () => {
  if ($('#local-audio-library').open) refreshAudioLibrary().catch(error);
});
$('#audio-video-mode').onclick = guard(() => load());
window.addEventListener('pagehide', () => localPlayer.dispose());

$('#audio-save-current').onclick = guard(() => startCapture(undefined, true));
