# 汉字岛 · Kanji Islands

词汇成岛，汉字相连。基于 Electron、React 和 TypeScript 的离线日语词汇探索应用。

## 功能

- 点击汉字展开关联词，支持缩放、平移、撤回与重做。
- 按单词、假名或中英文释义搜索，按标日初级／中级及课次筛选。
- 悬停词卡查看平假名读音，右侧展示读音和上下排列的中英文释义。
- 保留课次符号 `※`、`▼`，悬停“？”查看说明。
- 无需登录，离线运行；探索记录仅保留在当前窗口。

## 本地开发

需要 Node.js 22.12+。PDF、下载数据及生成结果不纳入 Git，克隆后需自行准备：

- `data/vocabulary/vocabulary.json`：主词库。
- `data/jitendex-zh/LICENSE`、`NOTICE.md`：词典许可与署名文件。
- 项目根目录的 `初级词汇表_完整校对文字版.pdf`、`中级词汇表_完整校对文字版.pdf`。

```sh
npm install
npm run dev
```

开发窗口支持界面热更新。浏览器预览使用 `npm run dev:web`，地址为 `http://127.0.0.1:5173`。

## 构建与打包

```sh
npm run build     # 构建
npm start         # 启动构建后的桌面应用
npm run package   # 生成应用目录
npm run dist      # 生成安装包
```

产物位于 `release/`，macOS Apple Silicon 应用为 `release/mac-arm64/汉字岛.app`。

## 检查

```sh
npm run typecheck
npm run format:check
npm test
npm run test:e2e
npm run test:desktop   # 需先构建
```

## 数据与许可

词汇来自标日初级／中级词汇表；释义基于 Jitendex 非官方中文版及 Jitendex / JMdict，中文尚未全部人工核验。

应用代码采用 [MIT](LICENSE)；词典派生数据采用 CC BY-SA 4.0，保留 greyindex、Stephen Kraus / Jitendex、EDRDG / JMdict 等上游署名。教材 PDF 为独立来源材料。完整词典许可可在应用“词库与来源”中查看。
