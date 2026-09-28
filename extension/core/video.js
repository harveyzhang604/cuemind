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
  } catch {}
  return null;
}
