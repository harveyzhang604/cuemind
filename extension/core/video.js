export function keyFromUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'www.youtube.com' && u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      return id ? `youtube:${id}:1` : null;
    }
    if (u.hostname === 'www.bilibili.com') {
      const id = u.pathname.match(/^\/video\/(BV\w+)(?:\/|$)/)?.[1];
      const part = Number(u.searchParams.get('p') || 1);
      return id && Number.isInteger(part) && part > 0 ? `bilibili:${id}:${part}` : null;
    }
    if (['www.miguvideo.com', 'miguvideo.com'].includes(u.hostname)) {
      const id = u.pathname.match(/^\/p\/live\/(\d+)\/?$/)?.[1];
      return id ? `migu:${id}:1` : null;
    }
  } catch {}
  return null;
}

// A Migu event URL contains several programmes. This checks the event only;
// programme identity must also be checked in the actual player before a commit.
export function matchesVideoUrl(key, value) {
  const urlKey = keyFromUrl(value);
  if (!urlKey || typeof key !== 'string') return false;
  if (!urlKey.startsWith('migu:')) return key === urlKey;
  return /^migu:\d+:\d+$/.test(key) && key.split(':')[1] === urlKey.split(':')[1];
}
