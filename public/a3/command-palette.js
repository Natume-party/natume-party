(function (global) {
  "use strict";

  /* 办公室端命令面板（Ctrl K）的匹配与排序。纯函数：不碰 DOM、网络与共享状态；
     app.js 负责面板界面、命令执行与项目搜索请求。 */

  var luton = global.LUTON = global.LUTON || {};

  function str(value) { return value === null || value === undefined ? "" : String(value); }
  function normalize(value) { return str(value).toLowerCase().replace(/\s+/g, ""); }

  /* 0 = 不匹配；分数越高越靠前：标题开头 > 标题包含 > 关键词开头 > 关键词包含 > 逐字顺序匹配。 */
  function scoreCommand(command, query) {
    var q = normalize(query);
    if (!q) { return 1; }
    var label = normalize(command.label);
    if (label.indexOf(q) === 0) { return 100; }
    if (label.indexOf(q) !== -1) { return 80; }
    var keywords = (command.keywords || []).map(normalize), i;
    for (i = 0; i < keywords.length; i += 1) { if (keywords[i].indexOf(q) === 0) { return 60; } }
    for (i = 0; i < keywords.length; i += 1) { if (keywords[i].indexOf(q) !== -1) { return 40; } }
    var position = 0;
    for (i = 0; i < q.length; i += 1) {
      position = label.indexOf(q.charAt(i), position);
      if (position === -1) { return 0; }
      position += 1;
    }
    return 20;
  }

  /* 返回匹配的命令（保持原顺序作为同分次序），可选 limit。 */
  function rankCommands(commands, query, limit) {
    var ranked = (commands || []).map(function (command, index) {
      return { command: command, score: scoreCommand(command, query), index: index };
    }).filter(function (item) { return item.score > 0; });
    ranked.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
    var result = ranked.map(function (item) { return item.command; });
    return limit ? result.slice(0, limit) : result;
  }

  /* 上下键在列表中循环移动。 */
  function moveIndex(current, delta, length) {
    if (!length) { return -1; }
    var next = (current < 0 ? (delta > 0 ? -1 : 0) : current) + delta;
    return ((next % length) + length) % length;
  }

  luton.commandPalette = { scoreCommand: scoreCommand, rankCommands: rankCommands, moveIndex: moveIndex };
  if (typeof module !== "undefined" && module.exports) { module.exports = luton.commandPalette; }
})(typeof window !== "undefined" ? window : globalThis);
