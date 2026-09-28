import { prompts } from '../services/prompts.js';
import { promptExamples, defaultDescriptions } from './prompt-examples.js';
import { defaults, endpoint } from '../services/ai-provider.js';
const $ = (s) => document.querySelector(s);
const ext = !!globalThis.chrome?.runtime?.id;
const capabilities = {
  boundary: '完整句边界',
  translation: '字幕翻译',
  study: '学习地图',
  analysis: '章节与精讲',
  qa: '视频问答',
  explain: '划词解释',
  refine: '笔记整理',
  focus: '目标重点词',
};
const promptControls = new Map();
for (const [key, title] of Object.entries(capabilities)) {
  const details = document.createElement('details'),
    summary = document.createElement('summary'),
    textarea = document.createElement('textarea');
  summary.textContent = title;
  textarea.id = `prompt-${key}`;
  textarea.maxLength = 6000;
  textarea.rows = 4;
  textarea.placeholder = '例如：' + promptExamples[key][0][1] + ' 留空使用默认方式。';
  textarea.setAttribute('aria-label', title + '提示词偏好');
  const label = document.createElement('label');
  label.textContent = '偏好示例';
  const select = document.createElement('select');
  select.id = `prompt-example-${key}`;
  select.setAttribute('aria-label', title + '偏好示例');
  const options = [
    ['default', '内置默认'],
    ...promptExamples[key].map(([name], i) => [String(i), name]),
    ['custom', '自定义'],
  ];
  for (const [value, text] of options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    select.append(o);
  }
  label.append(select);
  const preview = document.createElement('p');
  preview.className = 'hint prompt-example-preview';
  preview.id = `prompt-preview-${key}`;
  select.setAttribute('aria-describedby', preview.id);
  const row = document.createElement('div');
  row.className = 'row prompt-example-actions';
  const replace = document.createElement('button'),
    append = document.createElement('button');
  replace.type = append.type = 'button';
  replace.className = append.className = 'button';
  replace.textContent = '替换为示例';
  append.textContent = '追加示例';
  row.append(replace, append);
  const draft = () =>
    select.value === 'default' ? '' : promptExamples[key][Number(select.value)]?.[1];
  const update = () => {
    const text = draft(),
      custom = select.value === 'custom';
    preview.textContent = custom
      ? '直接编辑下方内容；不会替换已有偏好。'
      : select.value === 'default'
        ? '留空时使用内置提示词。点击下方按钮清空本项补充偏好。'
        : text;
    replace.textContent = select.value === 'default' ? '使用内置默认' : '替换为示例';
    replace.disabled = custom || textarea.value === text;
    append.hidden = custom || select.value === 'default';
    append.disabled =
      !!text &&
      (textarea.value.split('\n').includes(text) ||
        textarea.value.length + text.length + (textarea.value ? '\n'.length : 0) > 6000);
  };
  const sync = () => {
    const i = promptExamples[key].findIndex(([, text]) => text === textarea.value);
    select.value = !textarea.value ? 'default' : i >= 0 ? String(i) : 'custom';
    update();
  };
  select.onchange = update;
  textarea.oninput = () => {
    sync();
    $('#save-status').textContent = '偏好已修改，请保存设置。';
  };
  replace.onclick = () => {
    if (draft() === undefined) return;
    textarea.value = draft();
    sync();
    $('#save-status').textContent = '偏好已填入，可以继续编辑；保存后生效。';
  };
  append.onclick = () => {
    const text = draft();
    if (!text || append.disabled) return;
    textarea.value += (textarea.value ? '\n' : '') + text;
    sync();
    $('#save-status').textContent = '示例已追加，保存后生效。';
  };
  const builtin = document.createElement('div');
  builtin.className = 'prompt-builtin';
  const builtinTitle = document.createElement('p');
  builtinTitle.textContent = '默认处理方式';
  const description = document.createElement('p');
  description.id = `prompt-description-${key}`;
  description.className = 'prompt-description';
  description.textContent = defaultDescriptions[key];
  const technical = document.createElement('details');
  technical.className = 'prompt-technical';
  const technicalTitle = document.createElement('summary');
  technicalTitle.textContent = '查看完整提示词';
  technical.append(technicalTitle);
  const builtinText = document.createElement('pre');
  builtinText.id = `prompt-builtin-${key}`;
  builtinText.textContent = prompts[key];
  builtinText.tabIndex = 0;
  builtinText.setAttribute('aria-label', title + '内置提示词全文');
  technical.append(builtinText);
  builtin.append(builtinTitle, description, technical);
  const preferenceLabel = document.createElement('label');
  preferenceLabel.htmlFor = textarea.id;
  preferenceLabel.textContent = '你的补充偏好';
  const help = document.createElement('p');
  help.className = 'hint';
  help.id = `prompt-help-${key}`;
  help.textContent =
    '只需用日常语言描述你的要求，无需填写变量、句子编号或代码格式。程序会自动保留内置规则，并追加你的偏好。';
  textarea.setAttribute('aria-describedby', help.id);
  promptControls.set(key, sync);
  details.append(summary, builtin, label, preview, row, preferenceLabel, help, textarea);
  $('#prompts').append(details);
  const modelLabel = document.createElement('label');
  modelLabel.textContent = title + '模型';
  const input = document.createElement('input');
  input.id = `model-${key}`;
  input.placeholder = '使用默认模型';
  modelLabel.append(input);
  $('#capability-models').append(modelLabel);
}

let settings = { ...defaults },
  settingsLoaded = !ext;
if (ext) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!response?.ok || !response.data || typeof response.data !== 'object')
      throw new Error(response?.error || '后台未返回设置');
    settings = response.data;
    settingsLoaded = true;
  } catch {
    $('#save-status').textContent =
      '读取本地设置失败，当前空白不代表已保存的 Key 丢失。请重试读取，避免覆盖原配置。';
    $('#settings-form button[type="submit"]').disabled = true;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button';
    retry.textContent = '重试读取设置';
    retry.onclick = () => location.reload();
    $('#save-status').after(retry);
  }
}
// Preserve legacy languages when saving unrelated model settings.
const savedLanguage =
  String(settings.targetLanguage || defaults.targetLanguage).trim() || defaults.targetLanguage;
if (![...$('#targetLanguage').options].some((o) => o.value === savedLanguage)) {
  const option = document.createElement('option');
  option.value = savedLanguage;
  option.textContent = `已保存：${savedLanguage}`;
  $('#targetLanguage').append(option);
}
settings.targetLanguage = savedLanguage;
for (const key of [
  'transcriptProvider',
  'supadataApiKey',
  'provider',
  'baseUrl',
  'model',
  'apiKey',
  'targetLanguage',
  'asrUrl',
  'asrModel',
  'asrKey',
  'preBuffer',
  'postBuffer',
  'maxTokens',
])
  $('#' + key).value = settings[key] ?? defaults[key];
$('#timeout').value = settings.timeout / 1000;
for (const key of Object.keys(capabilities)) {
  $('#prompt-' + key).value = settings.prompts?.[key] || '';
  $('#model-' + key).value = settings.models?.[key] || '';
  promptControls.get(key)();
}
function updateModelKeyHelp() {
  const help = $('#model-key-help');
  if (!help) return;
  const providers = {
    deepseek: ['DeepSeek', 'https://platform.deepseek.com/api_keys'],
    openai: ['OpenAI', 'https://platform.openai.com/api-keys'],
    gemini: ['Google AI Studio', 'https://aistudio.google.com/apikey'],
  };
  let provider = providers[$('#provider').value];
  if (!provider) {
    try {
      if (new URL($('#baseUrl').value).hostname === 'api.groq.com')
        provider = ['Groq', 'https://console.groq.com/keys'];
    } catch {}
  }
  help.replaceChildren(document.createTextNode('用于字幕翻译、视频问答、重点词分析和笔记整理。'));
  if (provider) {
    const link = document.createElement('a');
    link.href = provider[1];
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '获取 ' + provider[0] + ' API Key ↗';
    help.append(link, document.createTextNode('，创建后粘贴到上方。'));
  } else
    help.append(
      document.createTextNode('请到所用服务商的官方控制台获取 API Key；本地 Ollama 通常无需 Key。'),
    );
}
updateModelKeyHelp();
$('#baseUrl').addEventListener('input', updateModelKeyHelp);
const asrPresets = {
  groq: ['https://api.groq.com/openai/v1', 'whisper-large-v3-turbo'],
  openai: ['https://api.openai.com/v1', 'whisper-1'],
};
function detectAsrProvider() {
  const entry = Object.entries(asrPresets).find(
    ([, p]) => $('#asrUrl').value.replace(/\/$/, '') === p[0] && $('#asrModel').value === p[1],
  );
  $('#asr-provider').value = entry?.[0] || 'custom';
  $('#asr-preset-help').textContent = entry
    ? '地址与模型已匹配；填写对应服务的 Key 后保存。'
    : '已保留现有地址和模型。选择服务商可自动填写推荐配置。';
}
detectAsrProvider();
$('#asr-provider').onchange = () => {
  const preset = asrPresets[$('#asr-provider').value];
  if (!preset) return;
  const changed = $('#asrUrl').value.replace(/\/$/, '') !== preset[0];
  $('#asrUrl').value = preset[0];
  $('#asrModel').value = preset[1];
  if (changed) $('#asrKey').value = '';
  $('#asr-preset-help').textContent = '已填写地址与模型，请填写此服务的 API Key 后保存。';
};
for (const id of ['asrUrl', 'asrModel']) $('#' + id).addEventListener('input', detectAsrProvider);

$('#provider').onchange = () => {
  const presets = {
    openai: ['https://api.openai.com/v1', 'gpt-4o-mini'],
    gemini: ['https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-flash'],
    deepseek: ['https://api.deepseek.com', 'deepseek-flash'],
    compatible: ['http://localhost:11434/v1', ''],
  };
  const p = presets[$('#provider').value];
  $('#baseUrl').value = p[0];
  $('#model').value = p[1];
  $('#apiKey').value = '';
  updateModelKeyHelp();
};
$('#reset-prompts').onclick = () => {
  for (const key of Object.keys(capabilities)) {
    $('#prompt-' + key).value = '';
    promptControls.get(key)();
  }
  $('#save-status').textContent = '已恢复默认，请保存设置。';
};
$('#settings-form').onsubmit = async (e) => {
  e.preventDefault();
  let saved = false;
  try {
    if (!ext) throw new Error('预览不保存密钥，请在已加载的扩展中设置。');
    if (!settingsLoaded) throw new Error('请先重试读取本地设置，原配置尚未加载。');
    const next = { ...defaults, prompts: {}, models: {} };
    for (const key of [
      'transcriptProvider',
      'supadataApiKey',
      'provider',
      'baseUrl',
      'model',
      'apiKey',
      'targetLanguage',
      'asrUrl',
      'asrModel',
      'asrKey',
    ])
      next[key] = $('#' + key).value.trim();
    for (const key of ['preBuffer', 'postBuffer', 'maxTokens'])
      next[key] = Number($('#' + key).value);
    next.timeout = Number($('#timeout').value) * 1000;
    next.baseUrl = endpoint(next.baseUrl);
    next.asrUrl = endpoint(next.asrUrl || defaults.asrUrl);
    for (const key of Object.keys(capabilities)) {
      next.prompts[key] = $('#prompt-' + key).value;
      next.models[key] = $('#model-' + key).value.trim();
    }
    const origins = [
      ...new Set(
        [
          next.baseUrl,
          ...(next.asrKey ? [next.asrUrl] : []),
          ...(next.supadataApiKey ? ['https://api.supadata.ai'] : []),
        ].map((url) => new URL(url).origin + '/*'),
      ),
    ]; // Start permission UI during the click gesture, but persist settings without
    // waiting for that dialog. Denied/pending permissions must not erase local keys.
    const access = chrome.permissions.request({ origins }).then(
      (granted) => ({ granted }),
      (error) => ({ error }),
    );
    const r = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: next });
    if (!r.ok) throw new Error(r.error);
    saved = true;
    $('#save-status').textContent = '已保存到本地，正在确认服务访问权限。';
    const permission = await access;
    if (permission.error || !permission.granted) {
      $('#save-status').textContent =
        '设置已保存到本地；服务访问权限尚未授予。再次点击保存设置可申请授权。';
      return;
    }
    $('#save-status').textContent = '已保存，返回视频侧栏即可使用。';
  } catch (e) {
    $('#save-status').textContent = (saved ? '设置已保存到本地；' : '') + e.message;
  }
};

const dataScopes = {
  'clear-cache': [
    '清除分析缓存',
    '清除 AI 概览、译文、学习地图、重点词分析与问答历史；保留原始字幕、所有笔记、手动设置和 API Key。',
  ],
  'delete-notes': [
    '删除全部笔记',
    '删除当前 Chrome 配置中所有视频的笔记；保留字幕、分析、问答和设置。',
  ],
  reset: [
    '重置扩展数据',
    '清除全部字幕、分析、问答、笔记、阅读位置、设置和 API Key，恢复初始状态。',
  ],
};
let pendingAction = null;
async function dataCounts() {
  if (!ext) return;
  const r = await chrome.runtime.sendMessage({ type: 'DATA_STATS' });
  if (r.ok)
    $('#data-counts').textContent =
      `当前保存 ${r.data.videos} 份字幕记录、${r.data.notes} 条笔记、${r.data.chats} 条问答。`;
}
for (const b of document.querySelectorAll('[data-manage]'))
  b.onclick = () => {
    pendingAction = b.dataset.manage;
    const [title, description] = dataScopes[pendingAction];
    $('#data-title').textContent = title;
    $('#data-description').textContent = description;
    $('#data-proceed').textContent = title;
    $('#data-confirm').showModal();
    $('#data-cancel').focus();
  };
$('#data-cancel').onclick = () => {
  pendingAction = null;
  $('#data-confirm').close();
};
$('#data-proceed').onclick = async () => {
  if (!pendingAction) return;
  const action = pendingAction;
  $('#data-proceed').disabled = true;
  try {
    if (!ext) throw new Error('预览不会删除数据，请在已加载的扩展中操作。');
    const r = await chrome.runtime.sendMessage({ type: 'MANAGE_DATA', action, confirmed: true });
    if (!r.ok) throw new Error(r.error);
    pendingAction = null;
    $('#data-confirm').close();
    if (action === 'delete-notes') localStorage.removeItem('cuemind-demo-notes');
    if (action === 'reset') {
      localStorage.clear();
      location.reload();
      return;
    }
    $('#data-status').textContent = dataScopes[action][0] + '已完成。';
    await dataCounts();
  } catch (e) {
    $('#data-status').textContent = e.message;
    $('#data-confirm').close();
  } finally {
    $('#data-proceed').disabled = false;
  }
};
await dataCounts();

$('#storage-usage').onclick = async () => {
  const b = $('#storage-usage');
  b.disabled = true;
  try {
    if (!ext) throw new Error('请在已加载的扩展中查看本地空间。');
    const r = await chrome.runtime.sendMessage({ type: 'STORAGE_USAGE' });
    if (!r.ok) throw new Error(r.error);
    const size = (n) => (n == null ? '未知' : (n / 1024 / 1024).toFixed(2) + ' MB');
    const names = { videos: '字幕与分析', notes: '笔记', chats: '问答', aiCache: '模型响应缓存' };
    const parts = Object.entries(r.data.stores).map(
      ([key, v]) => `${names[key]} ${v.count} 条，内容约 ${size(v.bytes)}`,
    );
    if (r.data.quota && r.data.usage >= r.data.quota * 0.85)
      parts.push('浏览器存储占用接近配额，请先导出备份，再按需清理缓存');
    $('#storage-usage-result').textContent =
      parts.join('；') +
      `。设置与阅读位置 ${size(r.data.localBytes)}。浏览器估计已使用 ${size(r.data.usage)} / 配额 ${size(r.data.quota)}。缓存不会自动过期，清除后缺失内容可能需要重新请求服务。`;
  } catch (e) {
    $('#storage-usage-result').textContent = e.message;
  } finally {
    b.disabled = false;
  }
};
