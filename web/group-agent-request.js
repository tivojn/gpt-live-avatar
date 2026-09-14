// Route clear requests from the real human even if the live voice declines to
// emit a delegation. Never run this against avatar dialogue or page content.
export function needsAgent(text){
 const t=String(text||'');
 return /\b(run|execute|test|debug|install|build)\b[\s\S]{0,180}\b(code|script|command|shell|python|javascript|terminal|tests?|app|package)\b|\b(screenshot|screen ?shot|computer use|browser use)\b|\b(click|type|scroll|navigate|browse)\b|\b(see|look|show|read|inspect)\b[\s\S]{0,120}\b(screen|window|webpage|web page|browser|tab)\b|运行|执行|截屏|截图|点击|浏览器|写代码|屏幕上/i.test(t)
  ||/\b(create|make|write|save|read|open|list|edit|rename|delete|remove|trash)\b[\s\S]{0,220}\b(file|folder|directory|desktop|document)\b/i.test(t)
  ||/\b(delete|remove|trash|discard)\b[\s\S]{0,100}\b(it|that|this)\b/i.test(t)
  ||/\b(create|make|write|save|read|open|edit)\b[\s\S]{0,180}\.[a-z0-9]{1,8}\b/i.test(t)
  ||/\b(this|current|open)\s+(web\s*page|page|tab|website)\b/i.test(t)
  ||/\bwhat do you think (of|about) this\b/i.test(t)
  ||/(创建|建立|新建|读取|保存|写入|查看|修改|删除).{0,100}(文件|文档|目录|桌面)|(?:这个|当前)(?:网页|页面)|你.*怎么看这个/.test(t);
}
