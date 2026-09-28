import { normalizeCaptions } from '../core/transcript.js';
import { localSentences, paragraphs } from '../core/sentence.js';
export function demoRecord() {
  const text = [
    [
      'The best way to learn something is to explain it in your own words.',
      '学习一件事最好的方式，是用自己的话把它讲清楚。',
    ],
    [
      'When you struggle to explain an idea, you have found a gap in your understanding.',
      '当你很难解释一个概念时，你就找到了理解中的缺口。',
    ],
    [
      'That gap is not a failure. It is a useful signal that tells you where to focus next.',
      '这个缺口不是失败，而是告诉你下一步该把注意力放在哪里。',
    ],
    [
      'Go back to the source material and look for the missing connection.',
      '回到原始材料，寻找缺失的联系。',
    ],
    [
      'Then try again, using a simple example from your everyday life.',
      '接着再试一次，用一个日常生活中的简单例子来说明。',
    ],
    [
      'Passive review can feel productive, but retrieval is what makes knowledge stick.',
      '被动复习可能让人觉得很有收获，但主动回想才能让知识留下来。',
    ],
    [
      'Pause the video. Ask yourself what the speaker just said, without looking at the transcript.',
      '暂停视频，不看字幕，问问自己刚才讲者说了什么。',
    ],
    [
      'Return to the difficult parts and listen with a specific question in mind.',
      '回到难懂的片段，带着一个具体问题重新听。',
    ],
    [
      'A short note in your own words is worth more than a page of copied highlights.',
      '一段用自己语言写下的短笔记，胜过一整页复制的重点。',
    ],
    [
      'Learning is a conversation between what you know and what you are trying to understand.',
      '学习，是你已有的知识与正在尝试理解的事物之间的一场对话。',
    ],
  ];
  const raw = normalizeCaptions(
    text.map((x, i) => ({ start: i * 10, end: i * 10 + 8, text: x[0] })),
    'demo',
  );
  const sentences = localSentences(raw).map((s, i) => ({ ...s, translation: text[i][1] }));
  return {
    id: 'demo:learning:1',
    videoKey: 'demo:learning:1',
    videoInfo: {
      platform: 'demo',
      videoId: 'learning',
      page: 1,
      title: 'How to learn deeply, one idea at a time',
      author: 'CueMind 原创体验材料',
      duration: 100,
      url: 'https://example.com/cuemind-demo',
    },
    rawCaptions: raw,
    sentences,
    paragraphs: paragraphs(sentences),
    transcriptMeta: { source: 'demo', language: 'en' },
    studyMap: sentences.map((s, i) => ({
      id: `study-${s.id}`,
      fromSentenceId: s.id,
      toSentenceId: s.id,
      start: s.start,
      end: s.end,
      level: [0, 1, 5, 8].includes(i) ? 'repeat' : 'normal',
      reason: [0, 1, 5, 8].includes(i)
        ? '核心方法：主动解释、检索和用自己的话记笔记。'
        : '解释与实例',
    })),
    studyChunks: {
      0: {
        summary: '示例学习判断：适合希望把“看过”转化为“学会”的人。核心是解释、主动回想和精准复听。',
      },
    },
    analysis: {
      chapters: [
        {
          fromSentenceId: sentences[0].id,
          toSentenceId: sentences[4].id,
          start: 0,
          end: 48,
          title: '解释，是理解的试金石',
          summary: '用自己的话讲清楚，找到理解的缺口，再回到原文。',
        },
        {
          fromSentenceId: sentences[5].id,
          toSentenceId: sentences[9].id,
          start: 50,
          end: 98,
          title: '从被动阅读到主动学习',
          summary: '主动回想、带问题复听，并留下自己的理解。',
        },
      ],
      quotes: [
        {
          sentenceId: sentences[8].id,
          start: 80,
          quote: text[8][0],
          reason: '笔记的价值来自主动理解。',
        },
      ],
      explanations: [],
    },
  };
}
