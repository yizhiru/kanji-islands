# 汉字岛 · Kanji Islands

词汇成岛，汉字相连。一款离线日语词汇探索应用。

[下载安装](https://github.com/yizhiru/kanji-islands/releases/latest) · [开发与构建](docs/development.md) · [Windows 打包](docs/windows-cloud-build.md)

## 功能

- 点击汉字展开词网，支持分支管理、自动折叠、撤回与重做。
- 搜索单词、假名及中英文释义，按标准词库或标日课次筛选。
- 释义按中文、日文、英文排列，可分别折叠，并显示词典名。
- 导入本地 Yomitan 词典 ZIP，补充中文与日文释义；不内置或自动下载明镜。
- 生词本保存在本机，候选词和词网展开默认先列 Shikken N2 核心词，再列标日初级、中级词，最后列其他词。搜索建议在同等匹配程度下使用相同顺序，也可在候选列表选择生词优先；提供单词复制、单词与日文例句朗读。
- 在「生词本 → 开始练习」逐词自测。点击单词听读音，按需显示假名或释义，熟悉后可移出生词本。
- 「词本练习」可直接选择「我的生词本」，有收藏时默认选中。N2 和导入的 UTF-8 CSV 按原表顺序每 20 条分一组，选中哪组就随机练习那一组。点「从本词本移除」可跳过已熟悉的词，也可以立即撤回。移除记录按词本保存在本机。

自定义 CSV 的第一行为 `word,reading,meaning`，其中只有 `word` 必填。应用提供可下载的示例，支持同一词形的不同读音。词本可以包含内置词库以外的词，填写假名和释义即可朗读和核对。

无需登录。上次的词网、生词本与导入词典保存在本机。桌面版默认使用已安装的系统日语语音，无需打开 VOICEVOX。在「设置 → 日语朗读 → 朗读引擎」可选择系统语音、VOICEVOX、Kokoro（jf_alpha）或 Open JTalk（Mei）。Kokoro 和 Open JTalk 自带运行环境。首次朗读或点击「下载并试听」时，应用仅下载所选引擎的语音资源，分别约 373 MB 和 25 MB，之后可离线朗读。选择 VOICEVOX 需启动本机 VOICEVOX。

[日语朗读引擎实测对比](docs/ja-tts-benchmark.md)

## 数据与许可

内置读音与英文释义来自 JMdict / Jitendex，中文来自 Jitendex 非官方中文版，尚未全部人工核验。标日课次来自已核对的教材词汇表，词典释义不等于教材原文。

N2 练习使用 Shikken 整理的 1,739 条参考词汇，保留原表顺序、读音、英文释义和文件头署名。词表由 Shikken 提供，词形、读音与英文释义来自 EDRDG / JMdict，均采用 CC BY-SA 4.0。练习优先显示相同读音的内置中文释义，缺少时显示原表英文。[Shikken N2 词表](https://shikken.app/en/jlpt-n2-vocabulary-list/) · [EDRDG 许可](https://www.edrdg.org/edrdg/licence.html) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

代码采用 [MIT](LICENSE)，内置词典派生数据采用 CC BY-SA 4.0。用户导入词典遵循各自许可；完整署名与许可见应用内“词库与来源”。
