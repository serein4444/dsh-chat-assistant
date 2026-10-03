/** `chat-assistant` namespace dictionaries (browser face copy). */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "chat-assistant";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'chip.open': "打开辅助对话";
    readonly 'chip.new': "新开辅助对话";
    readonly 'aux.delete': "删除辅助对话";
    readonly 'menu.title': "辅助对话";
    readonly 'menu.open': "打开 / 聚焦辅助对话";
    readonly 'menu.newDefault': "另开一个辅助对话";
    readonly 'menu.newByModel': "按模型另开";
    readonly 'menu.constraint': "附加约束文件";
    readonly 'menu.loading': "正在加载模型目录…";
    readonly 'menu.loadFailed': "模型目录加载失败";
};
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<ChatAssistantKey, string>;
/** Key domain of the `chat-assistant` namespace (zh is the source of truth). */
export type ChatAssistantKey = keyof typeof zh;
