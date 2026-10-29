# 汉字岛 · Kanji Islands

词汇成岛，汉字相连。基于 Electron、React 和 TypeScript 的离线日语词汇探索应用。

## 功能

- 点击汉字展开关联词，支持缩放、平移、撤回与重做。
- 候选词按“标日初级 → 标日中级 → 非标日匹配词”优先排序，同时匹配初级与中级的词归入初级优先。
- 汉字节点右上角可删除分支，并清理与起点断开的词和后续分支；其他分支仍连接的词会保留。删除支持撤回、重做和重新展开。
- 以完整 JMdict / Jitendex 快照为标准词库，约 21.1 万个词典条目、29.8 万组词形与读音；按单词、假名或中英文释义搜索。
- 保留 5,698 条已核对标日词条的教材课次，支持初级／中级及课次筛选。只对已核对的词形、读音和词典 ID 附加课次；“未匹配标日课次”不表示教材中一定没有该词。
- 悬停词卡查看平假名读音，右侧展示读音和上下排列的中英文释义。
- 每张词卡和详情区支持一键复制单词；详情中的词形、假名、课次与释义可以选中复制。
- 支持本机日语合成语音朗读，多读音分别播放；另有 Jisho 词典入口，联网查看词典与其收录的音频。系统朗读仅供参考，不作为真人发音或音调标准。
- 保留课次符号 `※`、`▼`，悬停“？”查看说明。
- 查词和词网无需登录、离线运行；探索记录仅保留在当前窗口。朗读需要已安装的本机日语语音，外部词典需要联网。

## 本地开发

需要 Node.js 22.12+、Python 3.10+ 和 `pypdf`（`python3 -m pip install pypdf`，仅数据构建脚本使用）。PDF、下载数据及生成结果不纳入 Git，克隆后需自行准备：

- `data/vocabulary/vocabulary.json`：已核对的教材词汇与来源记录。
- `data/jitendex-en/dictionary.zip`、`metadata.json`、`index.json`：Jitendex 2026.08.11.0。
- `data/jitendex-zh/dictionary.zip`、`metadata.json`、`index.json`：对应的非官方中文版 v2026.08.11-zh.4。两个压缩包必须来自同一 JMdict 快照，构建时校验 SHA-256、逐行身份和义项结构。
- `data/jitendex-zh/LICENSE`、`NOTICE.md`：词典许可与署名文件。
- 项目根目录的 `初级词汇表_完整校对文字版.pdf`、`中级词汇表_完整校对文字版.pdf`。

```sh
npm install
npm run dev
```

开发窗口支持界面热更新。浏览器预览使用 `npm run dev:web`，地址为 `http://127.0.0.1:5173`。

`npm run data:build` 会构建标准词库并叠加教材标签；首次需要解析完整词典，后续复用 `data/vocabulary/standard.json` 缓存。源数据或构建脚本变化会使缓存失效。相同义项共享存储，减小全词库的体积。若双语义项无法可靠对齐，保留英文并显示中文缺失提示，不猜译文。

## 构建与打包

```sh
npm run build     # 构建
npm start         # 启动构建后的桌面应用
npm run package   # 生成应用目录
npm run dist      # 生成安装包
```

产物位于 `release/`，macOS Apple Silicon 应用为 `release/mac-arm64/汉字岛.app`。

Windows x64 安装包可通过手动触发 GitHub Actions 在云端生成。首次需要从本机上传加密的运行资源包并配置 Actions Secret；词库和 PDF 继续不纳入 Git。准备、触发与下载步骤见 [Windows 云端打包](docs/windows-cloud-build.md)。

## 检查

```sh
npm run typecheck
npm run format:check
npm test
npm run test:e2e
npm run test:desktop   # 需先构建
```

## 数据与许可

词形、假名与英文释义来自 JMdict / Jitendex，中文来自 Jitendex 非官方中文版，尚未全部人工核验。教材标签来自标日初级／中级词汇表，原有待核对项目仍保留在独立审核队列，不自动加入教材标签。当前版本固定本地已校验的词典快照，不在启动时联网更新词库。

读音方案采用“本地假名 + 本机合成语音 + 外部词典”。首版不批量抓取或打包第三方录音；以后如接入真人音频库，应单独处理授权、音调与多读音匹配、覆盖率和离线体积。

应用代码采用 [MIT](LICENSE)；词典派生数据采用 CC BY-SA 4.0，保留 greyindex、Stephen Kraus / Jitendex、EDRDG / JMdict 等上游署名。教材 PDF 为独立来源材料。完整词典许可可在应用“词库与来源”中查看。
