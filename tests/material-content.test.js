import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materialItemKey,
  materialImages,
  pythonContentKey,
} from '../extension/core/material-content.js';
import { mergeMaterialFrames } from '../extension/core/materials.js';
import { materialsPackage } from '../extension/core/materials-archive.js';
import { inspectZip } from '../scripts/archive.mjs';
const code = (content, extra = {}) => ({
  kind: 'code',
  title: 'code',
  language: 'python',
  content,
  partial: false,
  uncertainties: [],
  ...extra,
});
const frame = (time, items) => ({
  time,
  items,
  imageId: 'image-' + time,
  hash: String(time + 1)
    .repeat(64)
    .slice(0, 64),
});
const fixture = (frames) => ({
  version: 1,
  model: 'deepseek-flash',
  frames,
  run: { status: 'done', scope: 'beginning', completed: frames.length },
});
const pictures = (frames) => frames.map((f) => ({ id: f.imageId, time: f.time, bytes: 8 }));

test('Python identity ignores formatting outside literals but preserves values, identifiers and block indentation', () => {
  const key = (s) => materialItemKey(code(s));
  assert.equal(key('if x:\n    value = 1'), key('if x:\n    value=1'));
  assert.equal(key('x = (1,\n     2)'), key('x=(1,2)'));
  assert.equal(key('x=1\n\ny=2'), key('x = 1\ny = 2'));
  for (const changed of ['if x:\n    value=2', 'if x:\n  value=1', 'if x:\n    values=1'])
    assert.notEqual(key('if x:\n    value=1'), key(changed));
  assert.notEqual(key('return x'), key('returnx'));
  assert.notEqual(key('x = "a b"'), key('x="ab"'));
  assert.notEqual(key("x='foo'"), key('x="foo"'));
  assert.notEqual(key('x += 1'), key('x =+ 1'));
  assert.notEqual(key('x="""a\n b"""'), key('x="""a\nb"""'));
  assert.notEqual(key('# todo\nx=1'), key('# done\nx=1'));
  assert.equal(pythonContentKey(''), pythonContentKey('   '));
});

test('repeated highlighted code pages share one source screenshot, with an all-originals option', () => {
  const frames = [frame(0, [code('x = 1')]), frame(3, [code('x=1')]), frame(6, [code('x=2')])];
  const images = pictures(frames);
  assert.deepEqual(
    materialImages(fixture(frames), images).map((i) => i.time),
    [0, 6],
  );
  assert.equal(materialImages(fixture(frames), images, true).length, 3);
  assert.equal(mergeMaterialFrames(frames).length, 2);
});

test('block grouping and crop warnings do not multiply identical visible code pages', () => {
  const frames = [
    frame(0, [code('x=1'), code('y=2', { partial: true, uncertainties: ['代码底部被截断'] })]),
    frame(3, [code('x = 1\ny = 2')]),
  ];
  assert.equal(materialImages(fixture(frames), pictures(frames)).length, 1);
  // Prefer the complete source image while preserving every original locally.
  assert.equal(materialImages(fixture(frames), pictures(frames))[0].time, 3);
});

test('same chart labels never hide visually different slide screenshots; unreadable code remains reviewable', () => {
  const slide = {
    kind: 'slide',
    title: 'chart',
    language: '',
    content: 'Accuracy',
    partial: false,
    uncertainties: [],
  };
  const frames = [
    frame(0, [slide]),
    frame(3, [slide]),
    frame(6, [code('x=[无法辨认]')]),
    frame(9, [code('x=[无法辨认]')]),
  ];
  assert.equal(materialImages(fixture(frames), pictures(frames)).length, 4);
});

test('blank starts and obsolete source images leave normal exports, while interrupted OCR images remain accessible', () => {
  const frames = [{ ...frame(0, []), blank: true }, frame(3, [code('x=1')])],
    images = [...pictures(frames), { id: 'older-image', time: 9, bytes: 8 }];
  assert.deepEqual(
    materialImages(fixture(frames), images).map((i) => i.id),
    ['image-3'],
  );
  const partial = fixture(frames);
  partial.run.status = 'failed';
  assert.ok(materialImages(partial, images).some((i) => i.id === 'older-image'));
  assert.equal(materialImages(fixture(frames), images, true).length, 3);
});

test('scrolling windows still join when other code or slide blocks appear between them', () => {
  const anchor = [
    '    self.input_projection = nn.Linear(1, embed_dim)',
    '    self.attention_layer = nn.MultiheadAttention(embed_dim, nhead, batch_first=True)',
    '    self.layer_norm = nn.LayerNorm(embed_dim)',
  ].join('\n');
  const frames = [
    frame(0, [code('class Model:\n' + anchor), code('print("unrelated")')]),
    frame(4, [code(anchor + '\n    self.classifier = nn.Linear(embed_dim, num_classes)')]),
  ];
  const result = mergeMaterialFrames(frames);
  assert.equal(result.length, 2);
  assert.match(result[0].content, /self.classifier/);
});

test('ZIP exports selected source screenshots plus all occurrence times, and can explicitly retain originals', async () => {
  const frames = [frame(0, [code('x = 1')]), frame(3, [code('x=1')]), frame(6, [code('x=2')])];
  const record = {
    videoInfo: {
      title: 'Course',
      platform: 'bilibili',
      videoId: 'BVfixture',
      page: 1,
      url: 'https://www.bilibili.com/video/BVfixture/',
    },
    videoMaterials: fixture(frames),
  };
  const load = async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/4AAB/9k=' });
  const files = inspectZip(
    Buffer.from(await (await materialsPackage(record, pictures(frames), load)).arrayBuffer()),
  );
  assert.equal(files.filter((f) => f.path.endsWith('.jpg')).length, 2);
  const manifest = JSON.parse(files.find((f) => f.path === 'materials.json').data);
  assert.equal(manifest.originalImageCount, 3);
  assert.deepEqual(manifest.images[0].times, [0, 3]);
  assert.equal(
    inspectZip(
      Buffer.from(
        await (
          await materialsPackage(record, pictures(frames), load, { allImages: true })
        ).arrayBuffer(),
      ),
    ).filter((f) => f.path.endsWith('.jpg')).length,
    3,
  );
});

test('non-Python code block order is part of screenshot identity', () => {
  const a = code('let x = 1;', { language: 'javascript' });
  const b = code('x += 1;', { language: 'javascript' });
  const frames = [frame(0, [a, b]), frame(3, [b, a])];
  assert.equal(materialImages(fixture(frames), pictures(frames)).length, 2);
});
