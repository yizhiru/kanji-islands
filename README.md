# 汉字岛 · Kanji Islands

词汇成岛，汉字相连。基于 Electron、React 和 TypeScript 的离线日语词汇探索应用。

## 功能

- 点击汉字展开关联词，支持缩放、平移、分支删除、自动折叠、撤回与重做。
- 按单词、假名或中英文释义搜索，支持标准词库、标日及课次筛选。
- 展示词库读音与释义，按中文、日文、英文排列，各语言可独立折叠并标注词典名；教材课次仅标注已核对结果。
- 设置中支持导入本地 Yomitan 词典 ZIP，优先补充中文、日文释义；支持停用和删除，不内置或自动下载明镜。
- 生词本支持添加、删除、搜索和本机保存；关联词可选默认排序或生词优先。
- 支持复制单词、本机日语语音朗读和 Jisho 词典跳转。

查词与词网无需登录、可离线使用。探索记录仅保留在当前窗口；朗读需安装本机日语语音，外部词典需联网。

## 本地开发

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

Windows 云端打包见 [打包指南](docs/windows-cloud-build.md)。

## 数据与许可

词形、读音和英文释义来自 JMdict / Jitendex，中文来自 Jitendex 非官方中文版，尚未全部人工核验。标日课次来自初级／中级词汇表，待审核记录不附加教材标签；未匹配课次不代表教材中没有该词。系统合成语音仅供参考。

应用代码采用 [MIT](LICENSE)，词典派生数据采用 CC BY-SA 4.0，并保留上游署名。教材 PDF 为独立来源材料，完整词典许可见应用内“词库与来源”。
