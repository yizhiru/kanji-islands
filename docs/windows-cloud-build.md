# Windows 云端打包

使用 GitHub Actions 的 `windows-2025` 环境生成 Windows x64 NSIS 安装包。本机只负责准备运行资源和发起构建，无需安装 Windows 或 Wine。

## 首次配置

需要本机安装 GitHub CLI，并通过 `gh auth login` 登录对本仓库有写权限的账号。Actions 工作流和配套脚本需要提交并推送到默认分支，才能在 GitHub 的 Actions 页面手动触发。工作流默认不会在 push 或 PR 时运行。

本机使用项目现有的完整源数据生成运行词库，再把运行词库、许可说明和两份教材词汇 PDF 加密上传：

```sh
node scripts/cloud-build-data.mjs prepare
node scripts/cloud-build-data.mjs upload yizhiru/kanji-islands
```

`prepare` 会执行 `scripts/prepare-app-data.mjs`，因此需要与本地开发相同的 Python、`pypdf`、词典及教材源文件。生成的资源必须与随后推送的应用代码兼容；特别是 v2 全词典资源需要支持 v2 的应用代码，不能与旧版仅支持 v1 的代码混用。

输出位于已被 Git 忽略的 `output/cloud-build/`：

- `build-data.enc`：AES-256-GCM 加密、gzip 压缩的运行资源包。
- `build-data.key`：本地密钥，权限为 `0600`，不要提交或分享。
- `manifest.json`：资源包 SHA-256 和对应草稿发布标签。

`upload` 会创建未发布的 Release 草稿，上传加密资源，并设置以下 Actions 配置：

| 类型     | 名称                          | 用途                               |
| -------- | ----------------------------- | ---------------------------------- |
| Secret   | `WINDOWS_BUILD_DATA_KEY`      | 解密资源包，不写入工作流或命令参数 |
| Variable | `WINDOWS_BUILD_DATA_ASSET_ID` | 同一仓库内的资源附件 ID            |
| Variable | `WINDOWS_BUILD_DATA_SHA256`   | 固定资源包 SHA-256                 |

上传过程可重试，不会覆盖已上传的同名快照。草稿应一直保持未发布状态。词库、PDF、密钥不加入 Git 历史；加密包也不是安装包的数据保护机制，最终 EXE 中仍包含可提取的运行词库和 PDF。

本仓库当前是公开仓库，Actions 日志与生成的安装包 artifact 也应视为可被其他有权访问者下载；不要在资源、日志或诊断文件中添加私人资料。

## 发起和下载构建

先将需要打包的代码及工作流提交、推送到 GitHub。云端构建的是选定分支的已提交代码，本机未提交改动不会自动上传。

```sh
gh workflow run windows-build.yml --repo yizhiru/kanji-islands --ref main
gh run list --repo yizhiru/kanji-islands --workflow windows-build.yml --limit 5
gh run watch RUN_ID --repo yizhiru/kanji-islands --exit-status
gh run download RUN_ID --repo yizhiru/kanji-islands --dir release/windows-cloud
```

也可以打开 GitHub 仓库 → Actions → Windows installer → Run workflow。成功后在该次运行的 Artifacts 区域下载安装包与 `SHA256SUMS.txt`。安装包保留 14 天，失败诊断保留 7 天；工作流不会自动创建公开 Release，也不配置 Windows 代码签名。

流程包括：

1. 获取选定提交的代码，安装 Node.js 24。
2. 下载加密资源、验证外层 SHA-256 与 GCM 认证标签，再按固定文件清单恢复资源。
3. `npm ci`、资源工具检查、TypeScript 检查和单元测试。
4. Vite 构建，electron-builder 生成 Windows x64 NSIS 安装包。
5. 校验打包后词库、许可与 PDF 的 SHA-256，启动已打包的 Windows 应用执行桌面检查。
6. 生成安装包校验和，上传 Actions artifact。

云端直接使用本机已经构建好的运行词库，不运行 `npm run build` 或 `npm test` 中的数据重建步骤，因此无需上传完整上游词典 ZIP 或安装 Python。`contents: write` 权限用于读取仅对有推送权限身份可见的草稿附件，令牌只传给下载步骤；构建和打包不自动发布内容。

## 更新词库

本机完成词库核对或升级后，重新执行 `prepare` 和 `upload`。新资源使用新的草稿标签和附件 ID，本地密钥复用；旧草稿保留用于追溯。上传只更新后续运行的默认资源，不会自动触发构建。不要在已有构建运行期间更新资源配置，以免新旧附件与校验值混用导致校验失败。

## 本地验证

```sh
node --test tests/cloud-build-data.test.mjs
```

这会验证包含日文文件名的资源恢复、PDF 路径映射，以及错误密钥、损坏内容和错误 SHA-256 在写入文件前被拒绝。
