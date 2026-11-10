# 开发与构建

需要 Node.js 22.12+、Python 3.10+。重建教材数据时需安装 `pypdf`。

数据与 PDF 不纳入 Git，克隆后需自行准备：

- `data/vocabulary/vocabulary.json`：已核对的教材词汇。
- `data/jitendex-en/`：Jitendex 2026.08.11.0 的 `dictionary.zip`、`metadata.json`、`index.json`。
- `data/jitendex-zh/`：对应中文版 v2026.08.11-zh.4 的上述文件，以及 `LICENSE`、`NOTICE.md`。中英文词典须使用同一 JMdict 快照。
- 根目录的 `初级词汇表_完整校对文字版.pdf`、`中级词汇表_完整校对文字版.pdf`。

```sh
npm install
npm run dev       # 桌面开发，支持热更新
npm run dev:web   # 浏览器预览：http://127.0.0.1:5173
```

开发和构建命令会自动准备应用数据，后续复用词库缓存。

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
```

Windows 云端打包见 [打包指南](windows-cloud-build.md)。

