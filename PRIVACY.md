# 隐私与数据流 / Privacy and data flow

生效日期：2026-09-28。适用于 CueMind 1.0.29。CueMind 没有开发者账号系统、服务器、广告、分析 SDK 或遥测。所有服务请求由扩展直接发出。

## 处理哪些内容

根据使用功能处理：当前视频的标准 URL、ID、分 P、标题、作者、描述与时长；字幕及时间戳；划选文字与上下文；问题与必要对话历史；保存的笔记及待整理/翻译内容；用户明确上传或录制的音频；模型配置、提示词偏好、API Key；阅读位置、目标标注及缓存。

## 数据发送到哪里

| 功能 | 接收者与内容 |
| --- | --- |
| 平台字幕 | YouTube / Bilibili 及其字幕资源域名；读取播放页元数据和字幕，必要的登录凭据由浏览器随平台请求发送，不复制到开发者服务或模型 |
| Supadata（可选、仅 YouTube） | `api.supadata.ai`；标准视频 URL、可用原文语言与对应 Key；只请求已有字幕 native，不请求生成字幕 |
| 翻译、解释、问答、学习地图、概览、重点词、笔记整理 | 用户配置的文本服务地址；功能需要的字幕批次/上下文、视频元数据、问题历史、选词或笔记与该服务 Key |
| 音频转写 | 用户配置的 ASR 服务；显式上传的文件或录制的音频块、模型参数与 ASR Key |
| 本机模型 | 用户配置的 localhost / 127.0.0.1 服务；扩展向该本机地址请求。该服务本身是否再联网取决于其配置 |

API Key 用于对应服务鉴权，不发送到 GitHub，不进入源码或学习备份。请求不经过 CueMind 开发者。外部服务的保存周期、账号设置和隐私政策独立适用。

在设置页配置服务前可阅读数据流说明。选择双语/译文并配置模型后，可自动分批翻译缺失的全片字幕；保存快速笔记后可在后台整理。其他 AI 分析通过对应功能入口发起。录音/上传必须明确操作，音频不写入源码目录或发行包。

## 本机保存、备份与清理

设置与 Key 保存在当前扩展的 `chrome.storage.local`，限制为可信扩展上下文读取。字幕、笔记、问答、派生学习结果和有效响应缓存保存在 IndexedDB。没有 Chrome sync 或 CueMind 云同步。

没有自动过期删除或视频数量上限；用户可查看记录数与估算占用，主动清理。浏览器/操作系统配额和设备清理仍可能影响持久数据，因此请定期备份。

- 删除笔记：保留其他学习数据和模型响应缓存。
- 清除分析缓存：删除分析、译文、目标词、问答及响应缓存，保留原始字幕、笔记、设置和 Key。
- 重置、卸载扩展或清除其浏览器数据：删除本机扩展数据及 Key。
- JSON 备份移除设置 Key，但保留学习内容，不应上传公共仓库。响应缓存不进入备份，跨机器恢复后可能需要重新生成缺失内容。

Chrome 扩展本地存储不是加密密码保险箱。具备设备或浏览器配置访问权限的人可能获取内容和 Key。使用专用 Key、服务商额度限制；发生泄漏时在服务商后台撤销或轮换 Key。清理本机数据不能撤回服务商已处理或保留的数据。

## 权限用途

| 权限 | 用途 |
| --- | --- |
| sidePanel | 侧栏学习界面 |
| storage | 本机设置、Key 和阅读状态 |
| activeTab | 用户触发功能时定位当前视频 |
| scripting | 读取视频页面及连接播放控制 |
| offscreen、tabCapture | 用户明确发起的当前标签页音频转写 |
| YouTube / Bilibili / api.bilibili.com / hdslb 域名 | 视频、原生字幕及播放器元数据 |
| 可选 HTTPS、localhost / 127.0.0.1 域名 | 支持自定义文本/ASR 服务；保存配置时仅请求实际配置的服务源，Supadata 按需请求 |

远程服务地址必须 HTTPS；本机 localhost/127.0.0.1 可用 HTTP。地址禁止内嵌账号、查询参数和片段；携带 Key 的模型/ASR/Supadata 请求拒绝重定向。权限不用于监控无关浏览记录。

## 修改与报告

数据流、权限或清理行为变化应同步到本文件和 CHANGELOG。安全报告按 [SECURITY.md](SECURITY.md) 私密提交。

English summary: CueMind stores keys/settings in local extension storage and learning data in IndexedDB, with no developer backend or telemetry. Cloud features send required content and the relevant authentication key directly to your configured provider. Bilingual mode can translate missing captions automatically; quick notes can be polished in the background. Optional Supadata handles existing YouTube captions; explicit audio uploads/recordings go to your ASR provider. Local deletion does not remove provider-retained data. Keys are excluded from settings backups, but backups still contain learning content. Local storage is not a password vault. Saved learning results do not silently expire; browser quota and device cleanup remain outside the extension's control.
