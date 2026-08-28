const r = require(`${__hooks}/lib/rules.js`);
function payload(kind, input) {
  const p = r.object(input, "叙事内容");
  const mainAudioUrl = r.safeUrl(p.mainAudioUrl || "");
  if (kind === "letter") {
    if (!["modern", "classical", "magic"].includes(p.variant))
      r.fail("INVALID_INPUT", "信件样式无效");
    const paragraphs = r.list(p.paragraphs, "信件段落", 100).map((item) => {
      r.object(item, "信件段落");
      const align = item.align || "left";
      if (!["left", "center", "right", "top", "bottom"].includes(align))
        r.fail("INVALID_INPUT", "段落对齐方式无效");
      return {
        content: r.text(item.content, "段落文字", 16000),
        align,
        delayMs: r.integer(item.delayMs ?? 0, "段落延迟", 0, 600000),
        audioUrl: r.safeUrl(item.audioUrl || ""),
      };
    });
    if (!paragraphs.length) r.fail("INVALID_INPUT", "请添加至少一段信件内容");
    return {
      variant: p.variant,
      description: r.text(p.description || "", "说明", 2000, false),
      hintText: r.text(p.hintText || "点击开启信件", "开启提示", 200),
      paragraphs,
      backgroundImages: r
        .list(p.backgroundImages || [], "背景图片", 30)
        .map((url) => r.safeUrl(url)),
      pageBackgroundUrl: r.safeUrl(p.pageBackgroundUrl || ""),
      mainAudioUrl,
      typingSpeedMs: r.integer(p.typingSpeedMs ?? 60, "打字间隔", 1, 2000),
    };
  }
  const lines = (items, name) =>
    r.list(items, name, 100).map((item) => {
      r.object(item, name);
      return {
        text: r.text(item.text, name, 16000),
        durationMs: r.integer(item.durationMs ?? 3000, "展示时长", 0, 600000),
        audioUrl: r.safeUrl(item.audioUrl || ""),
      };
    });
  const phrases = lines(p.phrases, "祝福段落");
  if (!phrases.length) r.fail("INVALID_INPUT", "请添加至少一段祝福内容");
  return {
    phrases,
    closingLines: lines(p.closingLines || [], "谢幕文字"),
    mainAudioUrl,
  };
}
module.exports = { payload };
