// Older chats are independent topics; existing records need no destructive migration.
export function topicKey(chat, index = 0) {
  return chat.topicId || chat.id || `legacy:${index}`;
}
export function conversationTopics(chats) {
  const groups = new Map();
  chats.forEach((chat, index) => {
    const id = topicKey(chat, index);
    if (!groups.has(id)) groups.set(id, { id, title: chat.question, items: [], updated: index });
    const group = groups.get(id);
    group.items.push(chat);
    group.updated = index;
  });
  return [...groups.values()].sort((a, b) => b.updated - a.updated);
}
export function noteSources(note, sentences) {
  const ids = new Set(note.sentenceIds || []);
  return sentences.filter((s) => ids.has(s.id));
}
