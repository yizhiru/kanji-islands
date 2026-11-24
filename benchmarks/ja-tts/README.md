# 日语词条与例句朗读基准

**给当前项目的词条朗读选型，建议保留 VOICEVOX。** 16 个孤立词中，两套独立识别器分别完整还原了 VOICEVOX 的 14 个和 15 个，均为三者最高。例句朗读则值得选 Kokoro，12 句的预测自然度逐句都高于另外两款，生成整句的中位耗时比 VOICEVOX 多约 42 毫秒。实时响应优先时，Open JTalk 最快，词条和例句的 P95 都低于 70 毫秒。

## 实测结果

| 引擎 | 词条 P50 / P95 | 例句 P50 / P95 | 词条 / 例句 RTF | 例句自然度预测（满分 5） |
| --- | ---: | ---: | ---: | ---: |
| VOICEVOX | 347 / 437 ms | 884 / 1,079 ms | 0.425 / 0.287 | 3.00 |
| Kokoro-82M | 324 / 474 ms | 927 / 1,177 ms | 0.243 / 0.242 | **4.14** |
| Open JTalk | **18 / 24 ms** | **54 / 65 ms** | **0.014 / 0.014** | 2.16 |

每格的两个回检结果依次来自 ReazonSpeech 和 Whisper Small。「完整匹配」表示回检得到的音素序列与参考读音完全一致。PER 越低越好。

| 引擎 | 词条完整匹配（各 16 项） | 词条 PER | 例句完整匹配（各 12 项） | 例句 PER |
| --- | ---: | ---: | ---: | ---: |
| VOICEVOX | **14 / 15** | 7.41% / 0.93% | 8 / 9 | 4.13% / 1.29% |
| Kokoro-82M | 10 / 9 | 17.59% / 11.11% | 9 / 8 | 0.78% / 1.81% |
| Open JTalk | 12 / 12 | 7.41% / 7.41% | 8 / 7 | 3.10% / 1.29% |

例如，输入「シーツ」时，两个识别器都把 Kokoro 的输出识别成了「シーズ」，同时都从另外两款还原了「シーツ」。例句的读音排名对识别器更敏感，ReazonSpeech 给 Kokoro 的 PER 最低，Whisper Small 给 VOICEVOX 和 Open JTalk 相同的最低 PER。三款引擎的首轮例句音频时长中位数分别为 3.19、3.96、3.83 秒，RTF 与生成同一句话实际需要等待的时间可结合阅读。

## 测试范围

2026-11-23 在 Apple M2 MacBook Air、16 GB 内存、macOS 27.2.1、Python 3.12.3 上本地测试。每个引擎只选一个女声，均使用 CPU 和本机内存中的模型。三者语速参数均设为 0.9，实际输出时长随声线和停顿而异。

| 引擎和声线 | 实测配置 |
| --- | --- |
| VOICEVOX 四国めたん・ノーマル | Core 0.16.3、官方 ONNX Runtime 1.17.3、4 线程、style 2。使用 `create_audio_query`、`speed_scale=0.9`、`synthesis`，对应项目当前的两步合成 |
| Kokoro-82M v1.0 jf_alpha | FP32 ONNX、4 线程、Misaki 日语 Cutlet 前端、UniDic Lite |
| Open JTalk メイ・ノーマル | pyopenjtalk-plus 的 vanilla 前端、Open JTalk 1.11 词典、HTS 参数合成，原生 48 kHz |

**词条**取仓库 N2 词表的 16 项，涵盖长音、促音、拗音和外来词。输入使用词表的假名读音，与点击项目「朗读」按钮的行为一致。**例句**采用 12 条预先写定的日语学习用句，直接传入含汉字的原文，另存目标读音。日期、数量词、数字和问句均有覆盖。[词表与署名](../../src/assets/shikken-jlpt-n2-en.csv) · [词条播放实现](../../src/core/usePronunciation.ts) · [项目 VOICEVOX 配置](../../electron/voicevox.cjs) · [例句与参考读音](sentences.tsv)

## 测量方法

- **合成耗时**从传入文字直到完整单声道 PCM WAV 返回，包括文字前端、模型推理和 WAV 编码。三个引擎均直接在本机进程调用。下载、模型加载、桌面端 IPC、本地 HTTP、音频设备排队和播放耗时均未计入。这里的毫秒数适合比较引擎，实际点击到出声还取决于桌面端。
- **重复测量**先用单独一句话暖机，然后串行合成 3 轮，每轮 28 项，每个引擎轮流排在第一、第二和第三位。每轮内各引擎的输入顺序一致。报告 P50（中位数）和最近秩 P95，并给出 RTF，即合成总秒数除以输出音频总秒数。每个引擎的首次调用与设置耗时单列在原始 JSON；它们是同一进程中的一次观察，存在共享导入和缓存。
- **读音回检**使用第一轮的 84 个原始 WAV，转成 16 kHz 单声道，分别交给 ReazonSpeech k2 v2 和 Whisper Small。两个识别器都离线贪心解码，均不接收目标文本。将识别结果和参考假名转换为音素，忽略清化和停顿，保留长音、促音和拨音。PER 为整组音素替换、遗漏和插入总数除以参考音素数。另计整项读音完全匹配数。短词缺少上下文，识别器听错、汉字转读音的歧义都可能带来误差。
- **自然度**对 12 条例句逐句计算 UTMOS22 strong 的 1–5 分预测，再对每款声线取均值。该分数是自动预测。此实验没有日语母语听众的主观评分，也未评定东京式音高重音的正确性。[UTMOS 原始论文](https://www.isca-archive.org/interspeech_2022/saeki22c_interspeech.pdf) · [ONNX 模型与输入约定](https://huggingface.co/TigreGotico/utmos-onnx)

## 同文试听

每个 WAV 依次朗读「調整（ちょうせい）」、「来月の三日に、新しい先生が来ます。」和「午後3時に、駅の東口で会いましょう。」。片段间加入半秒静音，统一转为 24 kHz，保留各引擎的响度和原始停顿。

| 声线 | 试听 |
| --- | --- |
| VOICEVOX:四国めたん | [WAV](samples/voicevox.wav) |
| Kokoro jf_alpha | [WAV](samples/kokoro.wav) |
| Open JTalk HTS Voice “Mei” | [WAV](samples/openjtalk.wav) |

VOICEVOX 音频使用四国めたん・ノーマル。Kokoro 音频使用 jf_alpha。HTS Voice “Mei” © 2009–2013 Nagoya Institute of Technology，CC BY 3.0。[VOICEVOX 声音库](https://github.com/VOICEVOX/voicevox_resource/blob/main/core/README.md) · [Kokoro 日语声线](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) · [Mei 声线署名](https://github.com/r9y9/pyopenjtalk/blob/master/pyopenjtalk/htsvoice/LICENSE_mei_normal.htsvoice)

## 复现

在仓库根目录运行，准备脚本固定了 macOS ARM64 二进制包和模型版本，校验 16 个下载文件的 SHA-256。模型与逐条 WAV 位于 Git 忽略的 `tmp/speech-bench/`。新一轮评测默认写入该目录的 `tts-run/result.json` 和 `tts-run/samples/`。[本次逐条原始结果](result-m2.json)

```sh
python3.12 benchmarks/ja-tts/prepare.py
python3.12 -m venv tmp/speech-bench/venv
tmp/speech-bench/venv/bin/python -m pip install -r benchmarks/ja-tts/requirements.txt tmp/speech-bench/tts/voicevox_core-0.16.3-cp310-abi3-macosx_11_0_arm64.whl
tmp/speech-bench/venv/bin/python benchmarks/ja-tts/run.py
tmp/speech-bench/venv/bin/python benchmarks/ja-tts/score.py
```
