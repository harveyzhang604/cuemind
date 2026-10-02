(() => {
  // Only an extension's isolated world may own the toolbar. A page-world copy
  // has no messaging API and must not create a clickable, broken Note button.
  const runtime = globalThis.chrome?.runtime;
  try {
    if (!runtime?.id || typeof runtime.sendMessage !== 'function' || !runtime.getManifest()) return;
  } catch {
    return;
  }
  if (
    typeof window.__cueMindPlayer === 'function' &&
    window.__cueMindPlayer() &&
    window.__cueMindToolsHost?.isConnected
  ) {
    document.querySelectorAll('#cuemind-tools').forEach((e) => {
      if (e !== window.__cueMindToolsHost) e.remove();
    });
    return;
  }
  window.__cueMindCleanup?.();
  let disposed = false;
  const valid = () => {
    try {
      return !disposed && !!chrome.runtime.getManifest();
    } catch {
      return false;
    }
  };
  window.__cueMindPlayer = valid;
  document.querySelectorAll('#cuemind-tools').forEach((e) => e.remove());
  const lifetime = new AbortController();
  let toolsTimer, tickTimer;
  let session = null,
    context = null,
    lastKey,
    lastSnapshot = '',
    repeat = 1,
    captureLocked = false,
    lastRange = null,
    keyboardUntil = 0,
    keyboardArmed = false,
    arrowPending = null,
    spaceHeld = false;
  const player = () => document.querySelector('video');
  const miguPage = ['www.miguvideo.com', 'miguvideo.com'].includes(location.hostname);
  function parseClock(value) {
    const parts = String(value || '')
      .trim()
      .split(':');
    if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return NaN;
    return parts.reduce((seconds, part) => seconds * 60 + Number(part), 0);
  }
  function playbackTime(v) {
    if (!miguPage || v.readyState < 2) return v.currentTime;
    const shown = parseClock(document.querySelector('#mod-player .cur-time')?.textContent);
    const duration = playbackDuration(v);
    return Number.isFinite(shown) && (!Number.isFinite(duration) || shown <= duration + 2)
      ? shown
      : v.currentTime;
  }
  function playbackDuration(v) {
    const shown = miguPage
      ? parseClock(document.querySelector('#mod-player .end-time')?.textContent)
      : NaN;
    return Number.isFinite(shown) ? shown : v.duration;
  }
  function mediaTime(v, displayed) {
    return miguPage ? Math.max(0, displayed - (playbackTime(v) - v.currentTime)) : displayed;
  }
  function cleanup(preserveNotice = false) {
    clearTimeout(arrowPending?.timer);
    arrowPending = null;
    disposed = true;
    stop();
    clearInterval(toolsTimer);
    clearInterval(tickTimer);
    clearTimeout(noticeTimer);
    lifetime.abort();
    clearFocus();
    if (!preserveNotice) host.remove();
    try {
      chrome.runtime.onMessage.removeListener(receive);
    } catch {}
  }
  window.__cueMindCleanup = cleanup;
  const alive = () => {
    if (valid()) return true;
    cleanup();
    return false;
  };
  const send = (message) => {
    if (!alive()) return;
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      cleanup();
    }
  };
  function key() {
    const u = new URL(location.href);
    if (['www.miguvideo.com', 'miguvideo.com'].includes(u.hostname)) {
      const id = u.pathname.match(/^\/p\/live\/(\d+)\/?$/)?.[1];
      const programme = document
        .querySelector('[current-content-id]')
        ?.getAttribute('current-content-id');
      return id && /^\d+$/.test(programme || '') ? `migu:${id}:${Number(programme)}` : null;
    }
    const yt = u.hostname === 'www.youtube.com';
    const id = yt ? u.searchParams.get('v') : u.pathname.match(/BV\w+/)?.[0];
    return id
      ? `${yt ? 'youtube' : 'bilibili'}:${id}:${yt ? 1 : Number(u.searchParams.get('p') || 1)}`
      : null;
  }
  function stop(pause = false, preserveRange = false) {
    const old = session;
    session = null;
    if (!preserveRange) lastRange = null;
    if (old) {
      clearInterval(old.timer);
      old.controller.abort();
    }
    if (pause) player()?.pause();
  }
  const isAd = () =>
    !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
  function snapshot() {
    const v = player();
    return v
      ? {
          time: playbackTime(v),
          duration: playbackDuration(v),
          paused: v.paused,
          rate: v.playbackRate,
          videoKey: key(),
          session: !!session,
          rangeStart:
            session?.ranges[session.index].start ??
            (v.paused && lastRange && Math.abs(playbackTime(v) - lastRange.end) < 0.6
              ? lastRange.start
              : null),
          rangeEnd: session?.ranges[session.index].end ?? null,
          repeat,
          seeking: v.seeking,
          readyState: v.readyState,
          // Seeking normally drops readyState while the next frame buffers.
          // Only an actual media error means playback is unavailable.
          unavailable: !!v.error,
          mediaErrorCode: v.error?.code || null,
          captureLocked,
          focusCaptionsEnabled: !!focusConfig?.enabled,
          focusCaptionsClosed: focusClosed,
          focusCaptionsVideoKey: focusConfig?.videoKey || focusClosedKey,
          isAd: isAd(),
        }
      : null;
  }
  async function command(m) {
    const v = player();
    if (!v) throw new Error('未找到播放器');
    if (m.videoKey && m.videoKey !== key()) throw new Error('视频已切换，播放命令已取消');
    if (typeof m.keyboardEnabled === 'boolean') {
      keyboardUntil = m.keyboardEnabled ? Date.now() + 6500 : 0;
      keyboardArmed = !!m.replayArmed;
    }
    if (m.action === 'keyboard') return true;
    if (m.action === 'state') return snapshot();
    if (m.action === 'focusCaptions') {
      configureFocus(m);
      return true;
    }
    if (isAd() && !['bind', 'stop', 'pause', 'capture-lock'].includes(m.action))
      throw new Error('正在播放广告，请跳过或等广告结束后再操作。');
    if (m.action === 'bind') {
      context = m;
      if ([1, 3, -1].includes(m.repeat)) repeat = m.repeat;
      return true;
    }
    if (m.action === 'repeat') {
      if (![1, 3, -1].includes(m.repeat)) throw new Error('循环次数无效');
      repeat = m.repeat;
      return true;
    }
    if (m.action === 'capture-lock') {
      captureLocked = !!m.locked;
      stop();
      return true;
    }
    if (captureLocked && !m.captureControl && !['stop', 'pause'].includes(m.action))
      throw new Error('请先停止录音，再跳转或改变速度。');
    if (['stop', 'pause'].includes(m.action)) {
      stop(true);
      return true;
    }
    if (m.action === 'play') {
      stop();
      try {
        await v.play();
      } catch (error) {
        if (!m.captureControl || error?.name !== 'NotAllowedError' || v.muted) throw error;
        // A background-opened history tab may be denied audible autoplay.
        // Start muted, then restore the user's original audio state immediately.
        v.muted = true;
        try {
          await v.play();
        } finally {
          v.muted = false;
        }
      }
      return true;
    }
    if (m.action === 'toggle') {
      stop();
      if (v.paused) await v.play();
      else v.pause();
      return true;
    }
    if (m.action === 'seek') {
      if (!Number.isFinite(m.time) || m.time < 0) throw new Error('跳转时间无效');
      stop();
      v.currentTime = mediaTime(v, m.time);
      return true;
    }
    if (m.action === 'rate') {
      if (!Number.isFinite(m.rate) || m.rate < 0.25 || m.rate > 4) throw new Error('播放速度无效');
      v.playbackRate = m.rate;
      return true;
    }
    if (m.action !== 'range') throw new Error('未知播放器命令');
    const ranges = m.ranges || [{ start: m.start, end: m.end }];
    if (
      !Array.isArray(ranges) ||
      !ranges.length ||
      ranges.some(
        (r) =>
          !r ||
          !Number.isFinite(r.start) ||
          !Number.isFinite(r.end) ||
          r.start < 0 ||
          r.end <= r.start ||
          (Number.isFinite(playbackDuration(v)) && r.start >= playbackDuration(v)),
      )
    )
      throw new Error('播放范围无效');
    const count = m.repeat ?? repeat;
    if (!Number.isInteger(count) || (count !== -1 && (count < 1 || count > 100)))
      throw new Error('循环次数无效');
    stop();
    const token = {
      ranges,
      index: 0,
      count,
      remaining: count === -1 ? Infinity : count,
      strict: m.strict === true,
      pre: Number.isFinite(m.pre) ? Math.min(0.25, Math.max(0, m.pre)) : 0.15,
      post: Number.isFinite(m.post) ? Math.min(0.25, Math.max(0, m.post)) : 0.15,
      controller: new AbortController(),
      videoKey: key(),
    };
    if (token.strict) {
      token.pre = 0;
      token.post = 0;
    }
    session = token;
    const seek = () => {
      lastRange = {
        ...token.ranges[token.index],
        end: Math.min(playbackDuration(v), token.ranges[token.index].end + token.post),
      };
      v.currentTime = mediaTime(v, Math.max(0, token.ranges[token.index].start - token.pre));
      return v.play();
    };
    const tick = () => {
      if (session !== token) return;
      if (key() !== token.videoKey || player() !== v || isAd()) {
        stop();
        return;
      }
      if (v.seeking) return;
      const boundary = Math.min(playbackDuration(v), token.ranges[token.index].end + token.post);
      if (playbackTime(v) >= boundary - (token.strict ? 0.012 * v.playbackRate : 0) || v.ended) {
        if (token.remaining > 1) token.remaining--;
        else if (token.index + 1 < token.ranges.length) {
          token.index++;
          token.remaining = token.count === -1 ? Infinity : token.count;
        } else {
          stop(true, true);
          if (token.strict && playbackTime(v) >= boundary)
            v.currentTime = mediaTime(
              v,
              Math.max(token.ranges[token.index].start, boundary - 0.001),
            );
          return;
        }
        seek().catch(() => {
          if (session === token) stop();
        });
      }
    };
    try {
      // Arm the boundary before play(): its promise may settle after a short range has finished.
      v.addEventListener('timeupdate', tick, { signal: token.controller.signal });
      v.addEventListener('ended', tick, { signal: token.controller.signal });
      token.timer = setInterval(tick, token.strict ? 10 : 40);
      await seek();
      if (session !== token) return true;
      return true;
    } catch (e) {
      const cancelled = e.name === 'AbortError' && (session !== token || v.paused);
      if (session === token) stop();
      if (cancelled) return true;
      throw e;
    }
  }
  // Focus captions are a view of immutable sentence text, never a second transcript.
  let focusConfig = null,
    focusHost = null,
    focusRoot = null,
    focusBody = null,
    focusStyle = null,
    focusObserver = null;
  let focusTarget = null,
    focusVideo = null,
    focusCue = null,
    focusCueKey = '',
    focusClosed = false,
    focusRAF = 0,
    focusPosition = null,
    focusClosedKey = null,
    focusNativeTarget = null,
    focusLayoutKey = '';
  let focusVideoAbort = null;
  function restoreNative() {
    focusStyle?.remove();
    focusStyle = null;
    focusNativeTarget?.removeAttribute('data-cuemind-focus-active');
    focusNativeTarget = null;
  }
  function clearFocus() {
    focusConfig = null;
    focusCue = null;
    focusCueKey = '';
    focusClosed = false;
    focusClosedKey = null;
    focusLayoutKey = '';
    cancelAnimationFrame(focusRAF);
    focusRAF = 0;
    focusObserver?.disconnect();
    focusObserver = null;
    focusVideoAbort?.abort();
    focusVideoAbort = null;
    focusVideo = null;
    restoreNative();
    focusHost?.remove();
    if (focusPosition && focusTarget?.style.position === 'relative')
      focusTarget.style.position = focusPosition.value;
    focusPosition = null;
    focusTarget = null;
    focusHost = null;
    focusRoot = null;
    focusBody = null;
  }
  function configureFocus(m) {
    if (m.enabled !== true) {
      clearFocus();
      return;
    }
    const videoKey = m.videoKey || key();
    if (!videoKey) return;
    const list = Array.isArray(m.sentences) ? m.sentences : [];
    const sentences = list
      .filter(
        (s) =>
          s &&
          typeof s.id === 'string' &&
          typeof s.rawText === 'string' &&
          s.rawText.trim() &&
          Number.isFinite(s.start) &&
          Number.isFinite(s.end) &&
          s.start >= 0 &&
          s.end > s.start,
      )
      .map((s) => {
        const parts =
          Array.isArray(s.parts) &&
          s.parts.every(
            (p) =>
              p &&
              typeof p.text === 'string' &&
              Number.isInteger(p.level) &&
              p.level >= 0 &&
              p.level <= 3,
          ) &&
          s.parts.map((p) => p.text).join('') === s.rawText
            ? s.parts.map((p) => ({ text: p.text, level: p.level }))
            : [{ text: s.rawText, level: 0 }];
        return {
          id: s.id,
          start: s.start,
          end: s.end,
          rawText: s.rawText,
          translation: typeof s.translation === 'string' ? s.translation : '',
          parts,
        };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);
    if (!sentences.length) {
      clearFocus();
      return;
    }
    const baseSize = Number.isFinite(m.baseSize) ? Math.max(14, Math.min(48, m.baseSize)) : 28;
    const translationSize = Number.isFinite(m.translationSize)
      ? Math.max(12, Math.min(48, m.translationSize))
      : 18;
    const language = ['original', 'bilingual', 'translation', 'translated'].includes(m.language)
      ? m.language
      : 'original';
    const wasKey = focusConfig?.videoKey;
    // Preserve the current cue's rendered parts while a background batch arrives.
    if (
      m.refreshCurrent === true ||
      wasKey !== videoKey ||
      focusConfig?.baseSize !== baseSize ||
      focusConfig?.translationSize !== translationSize ||
      focusConfig?.language !== language
    )
      focusCueKey = '';
    focusConfig = { videoKey, enabled: true, baseSize, translationSize, language, sentences };
    focusClosed = false;
    focusClosedKey = null;
    syncFocus();
  }
  function hideFocus() {
    if (focusHost) focusHost.hidden = true;
    focusCue = null;
    focusCueKey = '';
    focusLayoutKey = '';
    restoreNative();
  }
  function attachFocus(v) {
    const container =
      v.closest('#movie_player,.bpx-player-container,#mod-player') ||
      document.querySelector('#movie_player,.bpx-player-container,#mod-player');
    const fullscreen = document.fullscreenElement;
    const target =
      fullscreen && fullscreen.contains(v) && fullscreen !== v ? fullscreen : container;
    if (!target || !target.contains(v) || fullscreen === v) return false;
    if (!focusHost) {
      focusHost = document.createElement('div');
      focusHost.id = 'cuemind-focus-captions';
      focusHost.hidden = true;
      focusHost.style.cssText =
        'position:absolute;z-index:2147483645;pointer-events:none;box-sizing:border-box;overflow:visible;';
      focusRoot = focusHost.attachShadow({ mode: 'open' });
      const css = document.createElement('style');
      css.textContent =
        ':host([hidden]){display:none!important}.wrap{position:absolute;bottom:13%;left:4%;width:92%;box-sizing:border-box;text-align:center;color:#fff;font-family:Arial,sans-serif;line-height:1.48;text-shadow:0 1px 3px #000;pointer-events:none}.caption-shell{position:relative;display:inline-block;max-width:100%;pointer-events:auto}.caption-shell:hover::before{content:"";position:absolute;left:0;right:0;top:-28px;height:28px}.body{display:inline-block;box-sizing:border-box;max-width:100%;padding:.16em .4em;border-radius:5px;background:rgba(0,0,0,.76);overflow-wrap:anywhere;white-space:pre-wrap;vertical-align:bottom}.translation{display:block;font-size:var(--translation-size,18px);color:#eef1ef}.level-1{font-size:1.10em}.level-2{font-size:1.25em;font-weight:600}.level-3{font-size:1.40em;font-weight:700}.close{position:absolute;right:0;top:-28px;opacity:0;pointer-events:none;min-width:28px;min-height:28px;padding:2px 7px;border:1px solid #fff8;border-radius:50%;color:#fff;background:#182820dd;font-size:18px;cursor:pointer}.caption-shell:hover .close,.caption-shell:focus-within .close{opacity:1;pointer-events:auto}.close:focus-visible{outline:2px solid #fff;outline-offset:2px}';
      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      focusBody = document.createElement('div');
      focusBody.className = 'body';
      focusBody.setAttribute('aria-label', 'CueMind 视频字幕');
      const close = document.createElement('button');
      close.className = 'close';
      close.type = 'button';
      close.textContent = '×';
      close.title = '关闭 CueMind 视频字幕';
      close.setAttribute('aria-label', close.title);
      close.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const closedKey = focusConfig?.videoKey;
        clearFocus();
        focusClosed = true;
        focusClosedKey = closedKey;
        send({ type: 'PLAYER_TICK', ...snapshot() });
      };
      const shell = document.createElement('div');
      shell.className = 'caption-shell';
      shell.append(focusBody, close);
      wrap.append(shell);
      focusRoot.append(css, wrap);
    }
    if (target !== focusTarget) {
      if (focusPosition && focusTarget?.style.position === 'relative')
        focusTarget.style.position = focusPosition.value;
      focusTarget = target;
      focusPosition = null;
      if (getComputedStyle(target).position === 'static') {
        focusPosition = { value: target.style.position };
        target.style.position = 'relative';
      }
      target.append(focusHost);
      focusObserver?.disconnect();
      focusObserver = new ResizeObserver(() => {
        cancelAnimationFrame(focusRAF);
        focusRAF = requestAnimationFrame(() => {
          focusRAF = 0;
          if (alive()) layoutFocus();
        });
      });
      focusObserver.observe(target);
      focusObserver.observe(v);
    }
    if (focusVideo !== v) {
      focusVideoAbort?.abort();
      focusVideoAbort = new AbortController();
      focusVideo = v;
      for (const event of [
        'timeupdate',
        'seeked',
        'seeking',
        'loadedmetadata',
        'ratechange',
        'play',
        'pause',
        'emptied',
      ])
        v.addEventListener(event, syncFocus, { signal: focusVideoAbort.signal });
    }
    return true;
  }
  function layoutFocus() {
    if (!focusHost || focusHost.hidden || !focusTarget || !focusVideo || !focusConfig) return;
    const rect = focusVideo.getBoundingClientRect(),
      parent = focusTarget.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      hideFocus();
      return;
    }
    Object.assign(focusHost.style, {
      left: `${rect.left - parent.left - focusTarget.clientLeft + focusTarget.scrollLeft}px`,
      top: `${rect.top - parent.top - focusTarget.clientTop + focusTarget.scrollTop}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const layoutKey = JSON.stringify([
      rect.width,
      rect.height,
      focusConfig.baseSize,
      focusConfig.translationSize,
      focusConfig.language,
      focusCueKey,
    ]);
    if (layoutKey === focusLayoutKey) return;
    focusLayoutKey = layoutKey;
    const maxHeight = Math.max(20, rect.height * 0.55);
    let size = Math.min(focusConfig.baseSize, Math.max(14, rect.width / 22));
    focusBody.style.fontSize = `${size}px`;
    focusBody.style.setProperty('--translation-size', focusConfig.translationSize + 'px');
    focusBody.style.maxHeight = '';
    focusBody.style.overflow = '';
    focusBody.tabIndex = -1;
    // Keep every word. Extremely long cues get an accessible scroll region rather than truncation.
    while (focusBody.getBoundingClientRect().height > maxHeight && size > 12) {
      size = Math.max(12, size - 1);
      focusBody.style.fontSize = `${size}px`;
    }
    if (focusBody.getBoundingClientRect().height > maxHeight) {
      focusBody.style.maxHeight = `${maxHeight}px`;
      focusBody.style.overflow = 'auto';
      focusBody.style.pointerEvents = 'auto';
      focusBody.tabIndex = 0;
      focusBody.setAttribute('aria-label', '完整字幕较长，可滚动阅读；侧栏可查看完整内容');
    } else {
      focusBody.style.pointerEvents = 'none';
      focusBody.setAttribute('aria-label', 'CueMind 视频字幕');
    }
  }
  function syncFocus() {
    if (disposed || !focusConfig?.enabled) return;
    if (focusConfig.videoKey !== key()) {
      clearFocus();
      return;
    }
    const v = player();
    if (!v || (miguPage && v.readyState < 2) || isAd() || !attachFocus(v)) {
      hideFocus();
      return;
    }
    const t = playbackTime(v),
      list = focusConfig.sentences;
    // Last starting cue wins if native subtitle timing has a small overlap.
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= t) lo = mid + 1;
      else hi = mid;
    }
    const cue = list[lo - 1];
    if (!cue || t >= cue.end) {
      hideFocus();
      return;
    }
    const id = `${cue.id}:${cue.start}:${cue.end}`;
    if (id !== focusCueKey) {
      focusCueKey = id;
      focusCue = cue;
      focusLayoutKey = '';
      focusBody.dataset.language = focusConfig.language;
      focusBody.replaceChildren();
      if (!['translation', 'translated'].includes(focusConfig.language) || !cue.translation) {
        for (const part of cue.parts) {
          const span = document.createElement('span');
          span.textContent = part.text;
          if (part.level) span.className = `level-${part.level}`;
          focusBody.append(span);
        }
      }
      if (cue.translation && focusConfig.language !== 'original') {
        const translation = document.createElement('span');
        translation.textContent = cue.translation;
        translation.className = 'translation';
        focusBody.append(translation);
      }
    }
    focusHost.hidden = false;
    layoutFocus();
    if (!focusHost.hidden && !focusStyle) {
      focusNativeTarget = v.closest('#movie_player,.bpx-player-container,#mod-player');
      focusNativeTarget?.setAttribute('data-cuemind-focus-active', '');
      focusStyle = document.createElement('style');
      focusStyle.dataset.cuemindFocusNative = '';
      focusStyle.textContent =
        '[data-cuemind-focus-active] .ytp-caption-window-container,[data-cuemind-focus-active] .bpx-player-subtitle-panel,[data-cuemind-focus-active] .bpx-player-subtitle-wrap{visibility:hidden!important}';
      document.documentElement.append(focusStyle);
    }
  }

  const receive = (m, sender, reply) => {
    if (sender.id !== chrome.runtime.id || m?.type !== 'PLAYER') return;
    command(m)
      .then((data) => reply({ ok: true, data }))
      .catch((e) => reply({ ok: false, error: e.message }));
    return true;
  };
  chrome.runtime.onMessage.addListener(receive);
  let noteBusy = false,
    noticeTimer;
  const host = document.createElement('div');
  host.id = 'cuemind-tools';
  window.__cueMindToolsHost = host;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent =
    ':host{position:absolute;right:18px;top:50px;z-index:2147483646;font:14px sans-serif}button{cursor:pointer;border:0;border-radius:18px;background:#2e5945;color:white;padding:9px 14px;margin-left:8px}.notice{position:fixed;right:24px;bottom:80px;max-width:340px;background:#fff;color:#243b32;border-radius:12px;padding:18px;box-shadow:0 4px 24px #0003;white-space:pre-wrap;line-height:1.6}.notice:empty{display:none}';
  shadow.append(style);
  async function requestTools(message) {
    try {
      if (!valid() || typeof globalThis.chrome?.runtime?.sendMessage !== 'function')
        throw new Error('Extension context invalidated');
      return await chrome.runtime.sendMessage(message);
    } catch (e) {
      if (
        !valid() ||
        /Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(
          e.message,
        )
      ) {
        cleanup(true);
        open.disabled = noteButton.disabled = true;
        showNotice('插件连接已失效，请刷新视频页后再操作。若刚才正在保存，请先到笔记中确认。');
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => host.remove(), 3500);
        return null;
      }
      throw e;
    }
  }
  const open = document.createElement('button');
  open.textContent = '▶ CueMind';
  open.onclick = async () => {
    try {
      const r = await requestTools({ type: 'OPEN_PANEL' });
      if (r && !r.ok) showNotice(r.error || '打开失败');
    } catch (e) {
      showNotice(e.message);
    }
  };
  const noteButton = document.createElement('button');
  noteButton.textContent = '✎ Note · N';
  const notice = document.createElement('div');
  notice.className = 'notice';
  shadow.append(open, noteButton, notice);
  function showNotice(text, note) {
    clearTimeout(noticeTimer);
    notice.replaceChildren();
    const close = () => {
      notice.replaceChildren();
      notice.onmouseenter = notice.onmouseleave = null;
    };
    if (note) {
      const heading = document.createElement('strong');
      heading.textContent = '笔记已保存';
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:12px;color:#5e6b61;margin:6px 0';
      const seconds = Math.floor(note.timestamp);
      meta.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${note.videoInfo.title || '当前视频'}`;
      const quote = document.createElement('p');
      quote.textContent = note.body;
      quote.style.cssText = 'margin:8px 0;max-height:160px;overflow:auto';
      const link = document.createElement('button');
      link.textContent = '复制时间链接';
      link.onclick = () => {
        const u = new URL(note.videoInfo.url);
        u.searchParams.set('t', Math.floor(note.timestamp));
        navigator.clipboard
          .writeText(u.href)
          .then(() => (link.textContent = '已复制'))
          .catch(() => (link.textContent = '复制失败，请重试'));
      };
      notice.append(heading, meta, quote, link);
      notice.onmouseenter = () => clearTimeout(noticeTimer);
      notice.onmouseleave = () => {
        noticeTimer = setTimeout(close, 1500);
      };
    } else {
      notice.textContent = text;
      notice.onmouseenter = notice.onmouseleave = null;
    }
    noticeTimer = setTimeout(close, note ? 3000 : 5000);
  }
  async function saveQuickNote() {
    if (noteBusy || disposed) return;
    noteBusy = true;
    noteButton.textContent = '保存中…';
    try {
      const r = await requestTools({ type: 'QUICK_NOTE' });
      if (!r) return;
      if (!r.ok) throw new Error(r.error || '保存失败');
      showNotice((r.data.warning || '笔记已保存') + '\n' + r.data.note.body, r.data.note);
    } catch (e) {
      showNotice(e.message);
    } finally {
      noteBusy = false;
      noteButton.textContent = '✎ Note · N';
    }
  }
  noteButton.onclick = saveQuickNote;
  function attachTools() {
    if (!alive()) return;
    const target =
      document.fullscreenElement ||
      document.querySelector('#movie_player,.bpx-player-container,#mod-player');
    if (key() && target) {
      if (host.parentNode !== target) target.append(host);
    } else host.remove();
  }
  document.addEventListener(
    'fullscreenchange',
    () => {
      attachTools();
      syncFocus();
    },
    { signal: lifetime.signal },
  );
  toolsTimer = setInterval(attachTools, 1000);
  attachTools();
  const keyboardReady = () =>
    context?.sentences?.length && Date.now() < keyboardUntil && !captureLocked && !isAd();
  function singleArrow(direction) {
    const v = player();
    if (!v) return;
    command({
      action: 'seek',
      time: Math.max(
        0,
        Math.min(
          Number.isFinite(playbackDuration(v)) ? playbackDuration(v) : Infinity,
          playbackTime(v) + direction * 5,
        ),
      ),
      videoKey: key(),
    }).catch(() => {});
    keyboardArmed = false;
    send({ type: 'PLAYER_SHORTCUT', action: 'seek', videoKey: key() });
  }
  // Capture on window before the platform's document/player shortcut handlers.
  // Delay a single press briefly so a double press never seeks before expanding.
  window.addEventListener(
    'keydown',
    (e) => {
      if (
        !alive() ||
        e.isComposing ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.target.closest?.(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],dialog,[role="dialog"]',
        ) ||
        !keyboardReady()
      )
        return;
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const direction = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.repeat) {
          if (arrowPending) {
            clearTimeout(arrowPending.timer);
            arrowPending = null;
          }
          singleArrow(direction);
          return;
        }
        if (
          arrowPending &&
          arrowPending.key === e.key &&
          performance.now() - arrowPending.at <= 350
        ) {
          clearTimeout(arrowPending.timer);
          arrowPending = null;
          keyboardArmed = true;
          stop(true);
          send({ type: 'PLAYER_SHORTCUT', action: 'expand', direction, videoKey: key() });
          return;
        }
        if (arrowPending) {
          clearTimeout(arrowPending.timer);
          singleArrow(arrowPending.direction);
        }
        const pending = { key: e.key, direction, videoKey: key(), at: performance.now() };
        arrowPending = pending;
        pending.timer = setTimeout(() => {
          if (arrowPending !== pending) return;
          arrowPending = null;
          if (key() === pending.videoKey && keyboardReady()) singleArrow(direction);
        }, 350);
      } else if (e.key === ' ' && (keyboardArmed || session)) {
        spaceHeld = true;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        if (arrowPending) {
          clearTimeout(arrowPending.timer);
          arrowPending = null;
        }
        send({ type: 'PLAYER_SHORTCUT', action: 'space', videoKey: key() });
      }
    },
    { capture: true, signal: lifetime.signal },
  );
  // Consume the release of a Space we handled, even if starting/exiting a
  // replay has already changed keyboardArmed/session. Otherwise the platform
  // can toggle playback a second time on keyup.
  window.addEventListener(
    'keypress',
    (e) => {
      if (e.key === ' ' && spaceHeld) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, signal: lifetime.signal },
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key === ' ' && spaceHeld) {
        spaceHeld = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, signal: lifetime.signal },
  );
  window.addEventListener(
    'blur',
    () => {
      spaceHeld = false;
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (
        keyboardReady() &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.target.closest?.(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],dialog,[role="dialog"]',
        ) &&
        ['ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, signal: lifetime.signal },
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (!alive()) return;
      if (
        e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
      )
        return;
      if (
        e.key.toLowerCase() === 'n' &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.repeat
      ) {
        e.preventDefault();
        saveQuickNote();
        return;
      }
      if (e.key === 'Escape') {
        stop(true);
        return;
      }
      if (captureLocked || !e.altKey || !context?.sentences?.length) return;
      const action = e.key.toLowerCase();
      if (!['j', 'k', 'l', 'r', 'p'].includes(action)) return;
      const v = player();
      if (!v) return;
      e.preventDefault();
      const list = context.sentences,
        focus = snapshot().rangeStart;
      let i =
        focus == null
          ? list.findIndex((s) => s.start <= playbackTime(v) && playbackTime(v) < s.end)
          : list.findIndex((s) => s.start === focus);
      if (i < 0) {
        i = list.findLastIndex((s) => s.start <= playbackTime(v));
        i = Math.max(0, i);
      }
      if (action === 'j') i = Math.max(0, i - 1);
      if (action === 'l') i = Math.min(list.length - 1, i + 1);
      if (action === 'r') repeat = repeat === 1 ? 3 : repeat === 3 ? -1 : 1;
      const sentence = list[i],
        paragraph = context.paragraphs?.find((p) => p.sentenceIds.includes(sentence.id));
      command({
        action: 'range',
        ...(action === 'p' && paragraph ? paragraph : sentence),
        repeat,
        pre: context.pre,
        post: context.post,
        videoKey: key(),
      }).catch(() => {});
    },
    { signal: lifetime.signal },
  );
  function broadcastPlayer(playbackEvent) {
    if (!alive()) return;
    const nowKey = key();
    if (lastKey !== nowKey) {
      lastKey = nowKey;
      stop();
      if (focusConfig?.videoKey !== nowKey) clearFocus();
      context = null;
      keyboardUntil = 0;
      keyboardArmed = false;
      clearTimeout(arrowPending?.timer);
      arrowPending = null;
      captureLocked = false;
      send({ type: 'PAGE_CHANGED', videoKey: nowKey });
    }
    syncFocus();
    const state = snapshot();
    if (!state) return;
    const value = JSON.stringify(state);
    if (value !== lastSnapshot || captureLocked || playbackEvent) {
      lastSnapshot = value;
      send({
        type: 'PLAYER_TICK',
        ...state,
        sampleAt: Date.now(),
        ...(playbackEvent ? { playbackEvent } : {}),
      });
    }
  }
  // Media events do not bubble. Capture them so quick pauses/resumes and a
  // replaced video element are reported even before the periodic snapshot.
  for (const event of ['play', 'pause', 'seeked'])
    document.addEventListener(
      event,
      (e) => {
        if (e.target === player()) broadcastPlayer(event);
      },
      { capture: true, signal: lifetime.signal },
    );
  lastKey = key();
  tickTimer = setInterval(() => broadcastPlayer(), 180);
})();
