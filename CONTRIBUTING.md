# Contributing / 贡献指南

欢迎脱敏的功能问题、文档改进和小范围 PR。安全漏洞按 [安全说明](SECURITY.md) 私密报告。

说明问题、最终行为和验证方法，使用公共视频或合成字幕。不要提交真实 Key、Cookie、私人备份、日常浏览器截图、个人路径、dist 或开发临时文件。

1. 使用 Node.js 22，运行 npm ci。浏览器测试环境见 [开发说明](docs/DEVELOPMENT.md)。
2. 修改时保留字幕证据、句子 ID、用户笔记和既有缓存；不要静默增加服务请求、费用、数据采集或权限。
3. 运行 npm test、npm run check、npm run format:check、npm run build；按修改范围运行浏览器回归。
4. 新文件加入 scripts/public-files.json 和 .gitignore；新增图片仅使用合成/明确授权内容，并在素材说明记录来源。
5. PR 说明数据迁移、缓存失效和服务请求影响。涉及隐私/权限的变化同步更新 PRIVACY、SECURITY 和 CHANGELOG。

提交的自有代码按项目 MIT 许可证贡献；使用第三方代码时保留其许可和归属，不把 GPL 源码直接并入 MIT 发布范围。
