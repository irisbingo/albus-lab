# 阿不思实验室 · Albus Lab V1.0

面向 iPhone 的私人双语小说阅读器。暖米纸色、英文字体 Georgia、点击段落查看中文。零运行时第三方依赖，不需要 API、AI Token、登录账号或数据库服务器。

## 1. 在 Mac 上运行

解压 `Albus-Lab-V1.zip`，在终端进入 `albus-lab` 文件夹，然后运行：

```bash
python3 -m http.server 8080
```

浏览器打开 <http://localhost:8080/>。第一次使用，点击「导入 EPUB」选择原来的七本书；也可以先点「试读界面」。关闭服务器：Ctrl+C。局域网 HTTP 非安全来源，不适合作为 iPhone 离线 PWA 的最终安装方式。

## 2. 安装到 iPhone（推荐 GitHub Pages）

1. 创建一个独立的 GitHub 仓库（例如 `albus-lab`），把本目录中的应用代码上传到 `main` 根目录（`index.html`、三个 JS 模块、`style.css`、`sw.js`、manifest、两张 icon PNG、`.nojekyll`）。**不要上传 EPUB 小说文件或包含原文的任何数据。** GitHub 免费账号通常可使用公开仓库的 Pages；阅读器代码和网址公开，书籍不公开。
2. GitHub 仓库 Settings → Pages → Build and deployment → Deploy from a branch，选择 `main` 和 `/(root)`，保存。使用 Pages 提供的 HTTPS 地址。
3. 用 iPhone 上的 Safari 打开该地址，从分享菜单选择「添加到主屏幕」，如果界面有「作为网页 App 打开」开关，请打开它，然后添加。
4. **从新添加的主屏幕图标打开**，点击「导入 EPUB」，在「文件」App 中选择七份合法持有、无 DRM 的 EPUB 文件。你可以先 AirDrop 或用自己的 iCloud Drive 将 EPUB 放进「文件」App。若 Safari 和主屏幕网页 App 的存储隔离，请在主屏幕 App 内导入，而不是先在 Safari 导入。
5. 初次加载和导入完成后，打开任意章节，在飞行模式下关闭并重新打开 App，确认离线阅读和进度恢复成功。以后正常阅读不需要联网。保留原 EPUB 作为备份。

注意：没有进行实际 iPhone 验收；项目依赖浏览器支持 `DecompressionStream('deflate-raw')`、IndexedDB、CSS `:has()` 和 Service Worker。建议使用较新的 iOS Safari。设备存储策略、清理网站数据、卸载网页 App 或更换域名可能清除本地小说、进度和书签。不同设备之间不会自动同步。

## 3. 功能

- 七本书默认书架位置，导入即显示 EPUB 内置封面；书架显示上一次阅读和整本书进度。
- 阅读器上下滑动，点击英文组展示或收起对应中文组；中英对照、纯英文、纯中文四种模式。
- 章节中英目录、上一章、下一章、跳转；书签及定位、删除；保存到具体阅读组。
- 字号 14—28px、紧凑/标准/宽松行距、羊皮纸/白天/夜间主题。
- 使用系统长按选词；不内置词典或云端 AI。
- 书籍正文及封面存于 IndexedDB；进度、书签、设置存于 localStorage；Service Worker 缓存应用自身资源。所有正文解析均在设备完成，不发往服务器。

## 4. EPUB 导入规则及已知限制

本版针对提供的七份 EPUB 格式开发，识别 OPF spine 中的 chapter-N 及 epilogue 文件，读取 h1/h2 和 p 标签；若未匹配该命名方式则尝试 spine。根据实际 CJK 与拉丁字母比例及语言标签推断语言，而非盲信标签。连续英文组 + 连续中文组构成阅读单元。没有对译文做生成、补齐或语义重匹配。原段落的文本顺序被保留，空白会规范化，粗体/斜体等原 EPUB 内嵌样式没有保留。只有一侧语言的段落也保留，在对应阅读模式中显示。其他 EPUB 版式需额外适配。

实测七本均可解压和解析，198 个正文章节，65,039 个非空段落全部保留；2,659 个语言标签与文字分类不一致（按启发式规则重新分类，不能视为人工校验）。第七本未找到独立尾声章节及《十九年后》标题标记，疑似缺尾声，不擅自补写原作。参见 `test-results.json`。

## 5. 项目文件

| 文件 | 说明 |
|---|---|
| index.html / style.css | 页面入口和阅读样式 |
| app.js | 书架、阅读器、目录、书签和设置 |
| epub.js | ZIP 解压、EPUB 章节解析和双语分组 |
| store.js | IndexedDB / localStorage 本地存储 |
| sw.js / manifest.webmanifest | PWA 离线缓存与安装 |
| icon-192.png / icon-512.png | 原创应用图标 |
| PRD.md | 第一版范围、行为与验收标准 |
| test-results.json | 实际资源解析测试记录 |

应用代码采用原生 ES Modules / HTML / CSS，而非 React + TypeScript，以便无需 npm、构建或依赖安装即可运行、部署。此设计在后续功能增加时可迁移至 React。更新静态文件后务必递增 `sw.js` 的缓存版本，确保新版本发布后旧资源被清理。同一域名和路径可保留现有存储。
