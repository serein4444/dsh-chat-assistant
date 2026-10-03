/** `chat-assistant` namespace dictionaries (browser face copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'chat-assistant'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.open': '打开辅助对话',
  'chip.new': '新开辅助对话',
  'aux.delete': '删除辅助对话',
  'menu.title': '辅助对话',
  'menu.open': '打开 / 聚焦辅助对话',
  'menu.newDefault': '另开一个辅助对话',
  'menu.newByModel': '按模型另开',
  'menu.constraint': '附加约束文件',
  'menu.loading': '正在加载模型目录…',
  'menu.loadFailed': '模型目录加载失败',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<ChatAssistantKey, string> = {
  'chip.open': 'Open in auxiliary chat',
  'chip.new': 'New auxiliary chat',
  'aux.delete': 'Delete auxiliary chat',
  'menu.title': 'Aux chat',
  'menu.open': 'Open / focus auxiliary chat',
  'menu.newDefault': 'New auxiliary chat',
  'menu.newByModel': 'New with model',
  'menu.constraint': 'Attach constraint file',
  'menu.loading': 'Loading model catalog…',
  'menu.loadFailed': 'Failed to load the model catalog',
}

/** Key domain of the `chat-assistant` namespace (zh is the source of truth). */
export type ChatAssistantKey = keyof typeof zh
