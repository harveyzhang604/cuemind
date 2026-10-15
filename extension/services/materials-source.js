// Serialized into MAIN so URLs belong to the currently selected player session.
export async function inspectVideoSource(expectedKey) {
  const identity = () => {
    const u = new URL(location.href),
      youtube = u.hostname === 'www.youtube.com';
    return `${youtube ? 'youtube' : 'bilibili'}:${youtube ? u.searchParams.get('v') : u.pathname.match(/^\/video\/(BV\w+)/)?.[1]}:${youtube ? 1 : Number(u.searchParams.get('p') || 1)}`;
  };
  if (identity() !== expectedKey) throw new Error('视频已切换，请重新读取');
  const [platform, id, page] = expectedKey.split(':');
  let streams = [];
  if (platform === 'youtube') {
    const active = document.getElementById('movie_player')?.getPlayerResponse?.();
    const response = active?.streamingData ? active : window.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId === id)
      streams = [
        ...(response.streamingData?.adaptiveFormats || []),
        ...(response.streamingData?.formats || []),
      ];
    // Reuse already resolved video requests when player metadata contains only
    // a signature cipher. Never invent a signature or treat SABR/UMP as MP4.
    const mediaIds = new Set(
      streams.flatMap((stream) => {
        try {
          return [
            new URL(
              stream.url ||
                new URLSearchParams(stream.signatureCipher || stream.cipher || '').get('url'),
            ).searchParams.get('id'),
          ].filter(Boolean);
        } catch {
          return [];
        }
      }),
    );
    for (const entry of globalThis.performance?.getEntriesByType('resource') || []) {
      try {
        const u = new URL(entry.name),
          mime = u.searchParams.get('mime');
        if (
          !u.hostname.endsWith('.googlevideo.com') ||
          !mediaIds.has(u.searchParams.get('id')) ||
          !mime?.startsWith('video/') ||
          u.searchParams.has('ump') ||
          u.searchParams.has('sabr')
        )
          continue;
        const signed = (u.searchParams.get('sparams') || '').split(',');
        if (u.searchParams.has('range') && signed.includes('range')) continue;
        u.searchParams.delete('range');
        streams.push({
          url: u.href,
          mimeType: mime,
          height: Number(u.searchParams.get('height')) || 0,
        });
      } catch {
        /* Non-media performance entries are unrelated. */
      }
    }
  } else if (platform === 'bilibili') {
    const view = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${id}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(20000),
    });
    if (!view.ok) throw new Error(`B站视频信息请求失败（${view.status}）`);
    const cid = (await view.json()).data?.pages?.[Number(page) - 1]?.cid;
    if (!cid) throw new Error('未找到当前分 P 的视频');
    const response = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${id}&cid=${cid}&fnval=16&qn=80&fourk=0`,
      { credentials: 'include', signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw new Error(`B站视频地址请求失败（${response.status}）`);
    const body = await response.json();
    if (body.code !== 0) throw new Error(`B站未提供后台视频地址（${body.code}）`);
    streams = body.data?.dash?.video || [];
    // A single progressive file is also usable. Multipart FLV needs a demuxer.
    if (!streams.length && body.data?.durl?.length === 1 && /mp4/.test(body.data.format || ''))
      streams = [{ ...body.data.durl[0], mimeType: 'video/mp4' }];
  }
  if (identity() !== expectedKey) throw new Error('视频已切换，请重新读取');
  return streams.flatMap((s) =>
    [s.url || s.baseUrl || s.base_url, ...(s.backupUrl || s.backup_url || [])]
      .filter(Boolean)
      .map((url) => ({
        url,
        mimeType: s.mimeType || s.mime_type || 'video/mp4',
        codecs: s.codecs || '',
        height: Number(s.height) || 0,
        bytes: Number(s.contentLength || s.size) || 0,
        bandwidth: Number(s.bitrate || s.bandwidth) || 0,
      })),
  );
}

export function videoCandidates(platform, sources) {
  const allowed =
    platform === 'youtube'
      ? ['googlevideo.com']
      : platform === 'bilibili'
        ? ['bilivideo.com', 'bilivideo.cn', 'hdslb.com']
        : [];
  const seen = new Set();
  return (Array.isArray(sources) ? sources : [])
    .filter((s) => {
      try {
        const u = new URL(s.url);
        if (
          u.protocol !== 'https:' ||
          u.username ||
          u.password ||
          !allowed.some((d) => u.hostname === d || u.hostname.endsWith('.' + d)) ||
          !/^video\//.test(s.mimeType) ||
          seen.has(s.url)
        )
          return false;
        seen.add(s.url);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      // Legible code without downloading a 4K stream. H.264 works across Chrome builds.
      const score = (s) =>
        (s.height > 1080 ? 10000 + s.height : Math.abs((s.height || 720) - 1080)) +
        (/avc1|vp09|vp9/.test(s.codecs) ? 0 : 100);
      return score(a) - score(b) || (a.bandwidth || 0) - (b.bandwidth || 0);
    })
    .slice(0, 12);
}

export function materialsMediaRule(extensionId, platform) {
  if (platform !== 'bilibili') return null;
  return {
    id: 57301,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' }],
    },
    condition: {
      initiatorDomains: [extensionId],
      requestDomains: ['bilivideo.com', 'bilivideo.cn', 'hdslb.com'],
      resourceTypes: ['xmlhttprequest', 'media'],
    },
  };
}
