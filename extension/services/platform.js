// Runs in the page's MAIN world. Never pass provider keys into this function.
export function canReuseTranscript(record, tracks) {
  if (!record?.rawCaptions?.length) return false;
  const meta = record.transcriptMeta || {};
  if (meta.source === 'import' || meta.source?.startsWith('whisper') || meta.selectedByUser)
    return true;
  return !!tracks[0] && meta.trackId === tracks[0].id;
}
export async function inspectPage(trackId, expectedKey, signedPlayerUrl) {
  const fetchJson = async (url) => {
    const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`平台请求失败 HTTP ${r.status}`);
    return r.json();
  };
  const migu = ['www.miguvideo.com', 'miguvideo.com'].includes(location.hostname);
  const programmeId = () =>
    document.querySelector('[current-content-id]')?.getAttribute('current-content-id');
  const eventId = new URL(location.href).pathname.match(/^\/p\/live\/(\d+)\/?$/)?.[1];
  const keyNow = () =>
    migu
      ? `migu:${eventId}:${programmeId()}`
      : location.hostname.includes('youtube')
        ? `youtube:${new URL(location.href).searchParams.get('v')}:1`
        : `bilibili:${location.pathname.match(/BV[\w]+/)?.[0]}:${new URL(location.href).searchParams.get('p') || 1}`;
  if (expectedKey && keyNow() !== expectedKey && !(migu && expectedKey === `migu:${eventId}:1`))
    throw new Error('视频已切换，请重新加载。');
  const video = document.querySelector('video');
  if (migu) {
    const programme = programmeId();
    if (!eventId || !/^\d+$/.test(programme || '') || !video)
      throw new Error('咪咕播放器正在加载，请开始播放后重新读取。');
    const selected = document.querySelector(
      `.match-review__slide.is-active[data-program-id="${programme}"]`,
    );
    const label = selected?.textContent?.trim() || '';
    const info = {
      platform: 'migu',
      videoId: eventId,
      page: Number(programme),
      title: document.title.replace(/-咪咕视频$/, '') + (label ? ` · ${label}` : ''),
      author: '咪咕视频',
      description: '',
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      audioLanguage: label.includes('英文') ? 'en' : '',
      url: `https://${location.hostname}/p/live/${eventId}`,
    };
    return {
      info,
      tracks: [],
      raw: [],
      source: 'migu_audio',
      warning:
        '咪咕未提供可读取的字幕。点击「识别当前视频音频」，从当前进度开始逐段识别播放音频并自动补译；每段进度和结果会显示在侧栏，已有结果会从本机恢复。',
    };
  }
  const sameLanguage = (a, b) =>
    !!a &&
    !!b &&
    String(a).replace(/^ai-/, '').toLowerCase().split('-')[0] ===
      String(b).toLowerCase().split('-')[0];
  const rankTracks = (tracks, audioLanguage) =>
    tracks.sort(
      (a, b) =>
        Number(!sameLanguage(a.language, audioLanguage)) -
          Number(!sameLanguage(b.language, audioLanguage)) || Number(a.isAi) - Number(b.isAi),
    );
  if (location.hostname === 'www.youtube.com') {
    const id = new URL(location.href).searchParams.get('v');
    if (!id) throw new Error('请打开 YouTube 视频播放页。');
    let data = document.getElementById('movie_player')?.getPlayerResponse?.();
    if (!data || data.videoDetails?.videoId !== id) data = window.ytInitialPlayerResponse;
    if (data?.videoDetails?.videoId !== id) throw new Error('播放器正在切换，请稍后重试。');
    const info = {
      platform: 'youtube',
      videoId: id,
      page: 1,
      title: data.videoDetails.title,
      description: data.videoDetails.shortDescription || '',
      author: data.videoDetails.author,
      duration: Number(data.videoDetails.lengthSeconds) || video?.duration || 0,
      url: `https://www.youtube.com/watch?v=${id}`,
    };
    let playingAudio;
    try {
      playingAudio = document.getElementById('movie_player')?.getAudioTrack?.();
    } catch {}
    const preferredLanguage =
      playingAudio?.languageCode ||
      data.microformat?.playerMicroformatRenderer?.defaultAudioLanguage ||
      '';
    info.audioLanguage = preferredLanguage;
    const tracks = rankTracks(
      (data.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).map((t, i) => ({
        id: String(i),
        language: t.languageCode,
        label: t.name?.simpleText || t.name?.runs?.map((x) => x.text).join('') || t.languageCode,
        isAi: t.kind === 'asr',
        url: t.baseUrl,
      })),
      preferredLanguage,
    );
    if (trackId == null) return { info, tracks, source: 'youtube_native' };
    const track = tracks.find((t) => t.id === trackId) || tracks[0];
    if (!track) return { info, tracks, raw: [], source: 'youtube_native' };
    const url = new URL(track.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.youtube.com' ||
      url.pathname !== '/api/timedtext'
    )
      throw new Error('字幕地址无效');
    url.searchParams.set('fmt', 'json3');
    let transcript = null;
    // The player's live request may contain extra playback context absent from baseUrl.
    const candidates = [url.href, track.url];
    for (const entry of performance.getEntriesByType('resource').slice().reverse()) {
      try {
        const live = new URL(entry.name);
        if (
          live.hostname === 'www.youtube.com' &&
          live.pathname === '/api/timedtext' &&
          live.searchParams.get('v') === id &&
          live.searchParams.get('lang') === track.language &&
          (live.searchParams.get('kind') === 'asr') === track.isAi &&
          !live.searchParams.has('tlang')
        ) {
          live.searchParams.set('fmt', 'json3');
          candidates.unshift(live.href);
          break;
        }
      } catch {}
    }
    for (const candidate of [...new Set(candidates)]) {
      try {
        const r = await fetch(candidate, {
          credentials: 'include',
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) continue;
        const text = await r.text();
        if (!text.trim() || text.length > 5000000) continue;
        if (text.trim().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed.events?.length) {
            transcript = parsed;
            break;
          }
        } else {
          const xml = new DOMParser().parseFromString(text, 'text/xml');
          const events = [...xml.querySelectorAll('text,p')].map((node) => ({
            tStartMs:
              Number(node.getAttribute('start') || 0) * 1000 || Number(node.getAttribute('t') || 0),
            dDurationMs:
              Number(node.getAttribute('dur') || 0) * 1000 ||
              Number(node.getAttribute('d') || 2000),
            segs: [{ utf8: node.textContent }],
          }));
          if (events.length) {
            transcript = { events };
            break;
          }
        }
      } catch {}
    }
    if (keyNow() !== `youtube:${id}:1`) throw new Error('视频已切换，已丢弃旧字幕。');
    if (!transcript)
      return {
        info,
        tracks,
        track,
        raw: [],
        source: 'youtube_native',
        warning:
          'YouTube 返回了空字幕或拒绝了字幕请求。可在播放器中开启字幕后重试，或导入字幕/使用 ASR。',
      };
    return { info, tracks, track, json3: transcript, source: 'youtube_native' };
  }
  const id = location.pathname.match(/BV[\w]+/)?.[0],
    page = Number(new URL(location.href).searchParams.get('p') || 1);
  if (!id) throw new Error('请打开 Bilibili BV 视频播放页。');
  const view = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(id)}`,
  );
  if (view.code !== 0) throw new Error(`B站视频信息暂不可用（${view.code}）`);
  const part = view.data.pages?.[page - 1];
  if (!part) throw new Error('未找到当前分 P。');
  const info = {
    platform: 'bilibili',
    videoId: id,
    page,
    title: view.data.title + (page > 1 ? ` · P${page} ${part.part}` : ''),
    description: view.data.desc || '',
    author: view.data.owner?.name || '',
    duration: part.duration,
    url: `https://www.bilibili.com/video/${id}/?p=${page}`,
  };
  if (!signedPlayerUrl)
    return { info, cid: part.cid, needsWbi: true, tracks: [], source: 'bilibili_native' };
  const signed = new URL(signedPlayerUrl);
  if (
    signed.hostname !== 'api.bilibili.com' ||
    signed.protocol !== 'https:' ||
    signed.searchParams.get('bvid') !== id ||
    signed.searchParams.get('cid') !== String(part.cid)
  )
    throw new Error('视频分 P 已切换，请重新读取。');
  const response = await fetchJson(signedPlayerUrl);
  if (response.code !== 0)
    throw new Error(`B站字幕请求失败（${response.code}），请确认网页可播放并已登录。`);
  info.audioLanguage = response.data?.audio_language || '';
  const tracks = rankTracks(
    (response.data?.subtitle?.subtitles || []).map((t) => ({
      id: String(t.id),
      language: t.lan,
      label: t.lan_doc,
      isAi: t.lan.startsWith('ai-'),
      url: t.subtitle_url.startsWith('//') ? 'https:' + t.subtitle_url : t.subtitle_url,
    })),
    info.audioLanguage,
  );
  if (keyNow() !== `bilibili:${id}:${page}`) throw new Error('视频已切换，请重新加载。');
  return {
    info,
    tracks,
    track: tracks.find((t) => t.id === trackId) || tracks[0],
    source: 'bilibili_native',
  };
}
