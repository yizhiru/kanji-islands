# 开发与构建

需要 Node.js 22.12+、Python 3.10+。重建教材数据时需安装 `pypdf`。桌面开发与打包使用目标系统、目标架构的 Python 3.12 构建内置朗读引擎，可用 `KANJI_BUILD_PYTHON` 指定解释器。首次构建需要联网，后续复用 `tmp/speech-runtime/`。安装包自带运行环境。

数据与 PDF 不纳入 Git，克隆后需自行准备：

- `data/biaori/标日四册总词汇表.csv`：四册课次索引。构建时逐条对照两份校对稿，保留同词跨课记录和 ※、▼ 标记。仅已核准的词条关联具体读音和义项，其他记录按词头关联教材出处。
- `data/vocabulary/vocabulary.json`：已核对的教材词汇。
- `data/jitendex-en/`：Jitendex 2026.08.11.0 的 `dictionary.zip`、`metadata.json`、`index.json`。
- `data/jitendex-zh/`：对应中文版 v2026.08.11-zh.4 的上述文件，以及 `LICENSE`、`NOTICE.md`。中英文词典须使用同一 JMdict 快照。
- 根目录的 `初级词汇表_完整校对文字版.pdf`、`中级词汇表_完整校对文字版.pdf`。

```sh
npm install
npm run dev       # 桌面开发，支持热更新
npm run dev:web   # 浏览器预览：http://127.0.0.1:5173
```

开发和构建命令会自动准备应用数据，后续复用词库缓存。如果本地缺少课次 CSV，可先创建 `data/biaori/`，再从上述两份 PDF 重建：

```sh
python3 scripts/biaori_lessons.py > data/biaori/标日四册总词汇表.csv
```

教材词头的人工复核记录保存在 `scripts/biaori_reviewed_links.tsv`，逐行绑定校对稿原文、词典 ID、读音和义项序号。更新复核记录或活用映射后，运行 `python3 scripts/build_vocabulary.py` 重建本地词库和待核对队列，再运行 `npm run build` 更新应用数据。

## 构建与检查

```sh
npm run build         # 构建
npm start             # 启动已构建的桌面应用
npm run package       # 生成应用目录
npm run dist          # 生成安装包，输出至 release/
npm run typecheck
npm run format:check
npm test
npm run test:e2e
npm run test:desktop  # 需先构建
npm run test:speech   # 需先构建桌面端。用独立临时配置测试首次下载与断网重启
```

Windows 云端打包见 [打包指南](windows-cloud-build.md)。

