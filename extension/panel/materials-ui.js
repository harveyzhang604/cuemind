import { materialsMarkdown, mergeMaterialFrames, MATERIALS_MODEL } from '../core/materials.js';
import { formatTime, timestampUrl } from '../core/transcript.js';
import { materialImages } from '../core/material-content.js';
import { materialsPackage } from '../core/materials-archive.js';

export function createMaterialsUI({ getContext, rpc, error, ext }) {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#materials-dialog');
  let selected = null,
    images = [],
    packing = false,
    contentKey = '',
    data = null,
    running = false,
    poll = null,
    revision = 0;
  const setMessage = (text) => {
    $('#materials-status').textContent = text;
  };
  const report = (failure) => {
    setMessage(failure.message);
    error(failure);
  };
  const saveFile = (text, suffix, mime, title = selected.record.videoInfo.title) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(
      text instanceof Blob ? text : new Blob([text], { type: mime + ';charset=utf-8' }),
    );
    link.href = url;
    link.download = `${title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 90)}.${suffix}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pictureRows = new Map();
  function renderImages() {
    const visible = materialImages(data, images, $('#materials-all-images').checked);
    const present = new Set(visible.map((image) => image.id));
    for (const [id, row] of pictureRows)
      if (!present.has(id)) {
        row.remove();
        pictureRows.delete(id);
      }
    $('#materials-all-images').disabled = packing;
    $('#materials-zip').disabled = !visible.length || packing;
    $('#materials-images-count').textContent =
      `${$('#materials-all-images').checked ? '全部原始截图' : '按内容去重的截图'}（${visible.length}）`;
    $('#materials-frame-stats').textContent = images.length
      ? `已识别 ${data?.run?.completed ?? data?.frames?.length ?? 0} 个候选画面 · 去重后 ${materialImages(data, images).length} 张截图 · 原始 ${images.length} 张`
      : '';
    $('#materials-missing-images').hidden = !data?.frames?.some(
      (frame) => !frame.imageId || !images.some((image) => image.id === frame.imageId),
    );
    for (const image of visible) {
      if (pictureRows.has(image.id)) continue;
      const row = document.createElement('details'),
        summary = document.createElement('summary');
      const preview = document.createElement('button'),
        save = document.createElement('button');
      summary.textContent = formatTime(image.time);
      preview.textContent = '查看截图';
      save.textContent = '保存截图';
      preview.className = save.className = 'text-btn';
      preview.type = save.type = 'button';
      preview.onclick = async () => {
        preview.disabled = true;
        try {
          const recordId = selected.record.id;
          const result = await rpc('MATERIALS_IMAGE', { recordId, imageId: image.id });
          if (recordId !== selected?.record.id || !row.isConnected) return;
          const photo = document.createElement('img');
          photo.src = result.dataUrl;
          photo.alt = `视频 ${formatTime(image.time)} 的原始画面`;
          photo.className = 'materials-photo';
          row.append(photo);
          preview.remove();
        } catch (failure) {
          preview.disabled = false;
          report(failure);
        }
      };
      save.onclick = async () => {
        save.disabled = true;
        try {
          const chosen = selected;
          const result = await rpc('MATERIALS_IMAGE', {
            recordId: chosen.record.id,
            imageId: image.id,
          });
          saveFile(
            await (await fetch(result.dataUrl)).blob(),
            `${formatTime(image.time).replace(/:/g, '-')}.jpg`,
            'image/jpeg',
            chosen.record.videoInfo.title,
          );
        } catch (failure) {
          report(failure);
        } finally {
          save.disabled = false;
        }
      };
      row.append(summary, preview, save);
      $('#materials-image-list').append(row);
      pictureRows.set(image.id, row);
    }
    const list = $('#materials-image-list');
    visible.forEach((image, index) => {
      const row = pictureRows.get(image.id);
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
  }
  function render() {
    $('#materials-start').disabled = running;
    $('#materials-mode').disabled = running;
    $('#materials-stop').hidden = !running;
    const items = mergeMaterialFrames(data?.frames || []);
    $('#materials-save').disabled = !items.length;
    $('#materials-code').disabled = !items.some((item) => item.kind === 'code');
    $('#materials-json').disabled = !data?.frames?.length;
    renderImages();
    const key = JSON.stringify(data?.frames || []);
    if (contentKey !== key) {
      contentKey = key;
      const result = $('#materials-results');
      result.replaceChildren();
      $('#materials-count').textContent = items.length
        ? `去重后：${items.filter((i) => i.kind === 'code').length} 个代码片段 · ${items.filter((i) => i.kind === 'slide').length} 段课件文字`
        : '尚无提取内容';
      for (const item of items) {
        const details = document.createElement('details'),
          summary = document.createElement('summary');
        summary.textContent = `${formatTime(item.times[0])} · ${item.title || (item.kind === 'code' ? '代码' : '课件文字')}`;
        const source = document.createElement('a');
        source.href = timestampUrl(selected.record.videoInfo, item.times[0]);
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = '查看原视频画面';
        const code = document.createElement('pre');
        code.textContent = item.content;
        details.append(summary, source);
        if (item.partial || item.uncertainties.length) {
          const warning = document.createElement('p');
          warning.className = 'hint';
          warning.textContent = [item.partial ? '画面中未完整显示。' : '', ...item.uncertainties]
            .filter(Boolean)
            .join(' ');
          details.append(warning);
        }
        details.append(code);
        result.append(details);
      }
    }
    const run = data?.run;
    if (running && run?.phase === 'preparing-page')
      setMessage('正在准备独立后台页面 · 不影响当前视频播放');
    else if (running && run?.phase === 'downloading')
      setMessage(
        `后台下载视频 · 已下载 ${((run.received || 0) / 1e6).toFixed(1)} MB${run.total ? ` / ${(run.total / 1e6).toFixed(1)} MB` : ''} · 前台视频可正常使用`,
      );
    else if (running)
      setMessage(
        `${run?.engine === 'background' ? '后台快速分析' : '正在检测画面变化'} · ${formatTime(run?.observedThrough || 0)} · 候选画面 ${run?.detected || 0} 个 · 已识别 ${run?.completed || 0} 个，仍在去重`,
      );
    else if (run?.status === 'done')
      setMessage(
        `${run.scope === 'current' ? '当前画面' : run.scope === 'remaining' ? '当前位置之后的画面' : '本次全片扫描'}识别与去重完成，结果已保存到本机。`,
      );
    else if (run) setMessage(run.error || '上次提取已中断，已完成的内容仍可导出。');
  }
  async function refresh() {
    if (!selected) return;
    const rev = revision;
    const result = await rpc('MATERIALS_GET', { recordId: selected.record.id });
    if (rev !== revision) return;
    data = result.data;
    images = result.images || [];
    running = result.running;
    render();
  }
  $('#materials-start').onclick = async () => {
    if (!selected || running) return;
    const chosen = selected,
      rev = revision,
      autoExport = $('#materials-auto-export').checked;
    let succeeded = false,
      failure;
    try {
      if (!ext || chosen.record.videoInfo.platform === 'demo')
        throw new Error('请在已加载的 Chrome 扩展中打开视频后使用。');
      const live = getContext();
      if (live.record?.id !== chosen.record.id || live.localAudioMode || !chosen.tabId)
        throw new Error('画面提取需要打开这条记录对应的在线视频，音频文件没有视频画面。');
      running = true;
      render();
      await rpc('MATERIALS_EXTRACT', {
        recordId: chosen.record.id,
        tabId: chosen.tabId,
        options: { mode: $('#materials-mode').value },
      });
      succeeded = true;
    } catch (error) {
      failure = error;
    } finally {
      if (rev === revision) {
        running = false;
        await refresh().catch(report);
        if (failure) report(failure);
        else if (succeeded && autoExport && images.length) await $('#materials-zip').onclick();
      }
    }
  };
  $('#materials-stop').onclick = async () => {
    try {
      await rpc('CANCEL', { recordId: selected.record.id, capability: 'materials' });
      setMessage('正在停止，已提取的内容会保留…');
    } catch (failure) {
      report(failure);
    }
  };
  $('#materials-zip').onclick = async () => {
    const chosen = selected;
    packing = true;
    renderImages();
    try {
      const archive = await materialsPackage(
        { ...chosen.record, videoMaterials: data },
        images,
        (imageId) => rpc('MATERIALS_IMAGE', { recordId: chosen.record.id, imageId }),
        { allImages: $('#materials-all-images').checked },
      );
      saveFile(archive, 'materials.zip', 'application/zip', chosen.record.videoInfo.title);
    } catch (failure) {
      report(failure);
    } finally {
      packing = false;
      renderImages();
    }
  };
  for (const [selector, codeOnly] of [
    ['#materials-save', false],
    ['#materials-code', true],
  ])
    $(selector).onclick = () => {
      try {
        saveFile(
          materialsMarkdown({ ...selected.record, videoMaterials: data }, codeOnly),
          codeOnly ? 'code.md' : 'materials.md',
          'text/markdown',
        );
      } catch (failure) {
        report(failure);
      }
    };
  $('#materials-json').onclick = () =>
    saveFile(
      JSON.stringify(
        {
          format: 'cuemind-materials',
          version: 1,
          videoInfo: selected.record.videoInfo,
          ...data,
          contents: mergeMaterialFrames(data?.frames || []),
        },
        null,
        2,
      ),
      'materials.json',
      'application/json',
    );
  $('#materials-all-images').onchange = renderImages;
  $('#materials-settings').onclick = () => {
    if (ext) chrome.tabs.create({ url: chrome.runtime.getURL('panel/settings.html#text-service') });
    else location.assign('settings.html#text-service');
  };
  dialog.addEventListener('close', () => {
    clearInterval(poll);
    poll = null;
  });
  return {
    async open() {
      const context = getContext();
      if (!context.record) throw new Error('请先读取视频。');
      revision++;
      selected = { ...context };
      data = null;
      images = [];
      contentKey = '';
      pictureRows.clear();
      $('#materials-image-list').replaceChildren();
      running = false;
      $('#materials-video-title').textContent = context.record.videoInfo.title;
      $('#materials-model').textContent =
        `模型：${MATERIALS_MODEL} · 使用设置中的 DeepSeek 服务与 Key`;
      setMessage('点击开始后检测画面变化，不会重新识别音频或字幕。');
      render();
      dialog.showModal();
      if (ext && context.record.videoInfo.platform !== 'demo') await refresh();
      clearInterval(poll);
      if (ext && context.record.videoInfo.platform !== 'demo')
        poll = setInterval(() => {
          if (dialog.open) refresh().catch(report);
        }, 1500);
    },
  };
}
