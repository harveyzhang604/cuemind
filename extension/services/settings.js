import { defaults, endpoint } from './ai-provider.js';

export const capabilities = [
  'boundary',
  'translation',
  'study',
  'analysis',
  'qa',
  'explain',
  'refine',
  'focus',
];
export function validateSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式无效');
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input[key] ?? fallback;
    if (key === 'prompts' || key === 'models') {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('模型或提示词设置无效');
      result[key] = {};
      for (const name of capabilities) {
        const text = value[name] ?? '';
        if (typeof text !== 'string' || text.length > (key === 'prompts' ? 6000 : 200))
          throw new Error('提示词或模型名称过长');
        result[key][name] = text;
      }
    } else if (typeof fallback === 'string') {
      if (typeof value !== 'string' || value.length > 4096) throw new Error('设置字段格式无效');
      result[key] = value.trim();
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('设置数值无效');
      result[key] = value;
    }
  }
  if (!['openai', 'gemini', 'deepseek', 'compatible'].includes(result.provider))
    throw new Error('模型服务商无效');
  if (!['platform', 'fallback', 'supadata'].includes(result.transcriptProvider))
    throw new Error('字幕服务设置无效');
  if (result.transcriptProvider !== 'platform' && !result.supadataApiKey)
    throw new Error('使用 Supadata 前请填写 API Key');
  // DeepSeek retired the legacy aliases in July 2026. Migrate existing installs
  // when settings are read so a saved `deepseek-chat` does not fail silently.
  if (result.provider === 'deepseek') {
    if (
      ['deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(result.model)
    )
      result.model = 'deepseek-flash';
    if (result.model === 'deepseek-reasoner') result.model = 'deepseek-v4-pro';
    for (const name of capabilities) {
      if (
        ['deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(
          result.models[name],
        )
      )
        result.models[name] = 'deepseek-flash';
      if (result.models[name] === 'deepseek-reasoner') result.models[name] = 'deepseek-v4-pro';
    }
  }
  result.baseUrl = endpoint(result.baseUrl);
  result.asrUrl = endpoint(result.asrUrl);
  for (const [key, min, max] of [
    ['timeout', 5000, 180000],
    ['maxTokens', 512, 32768],
    ['preBuffer', 0, 0.25],
    ['postBuffer', 0, 0.25],
  ]) {
    if (result[key] < min || result[key] > max) throw new Error(`${key} 超出允许范围`);
  }
  if (!result.model || !result.asrModel || !result.targetLanguage)
    throw new Error('请填写模型名称和目标语言');
  return result;
}

// A restored endpoint must never inherit a credential belonging to another service.
export function restoreSettings(backup, current) {
  const next = validateSettings({
    ...backup,
    apiKey: '',
    asrKey: '',
    supadataApiKey: current.supadataApiKey || '',
    transcriptProvider: current.supadataApiKey
      ? (backup.transcriptProvider ?? current.transcriptProvider ?? 'platform')
      : 'platform',
  });
  if (next.baseUrl === endpoint(current.baseUrl) && next.provider === current.provider)
    next.apiKey = current.apiKey;
  if (next.asrUrl === endpoint(current.asrUrl)) next.asrKey = current.asrKey;
  return next;
}
