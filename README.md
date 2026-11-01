# 稿镜 Manuscript Mirror — VS Code 插件

把网页版"稿镜"（https://kongyuxiao.vercel.app）的 AI 写作诊断功能接入编辑器，不需要重新实现模型调用逻辑——插件只是网页版同一个后端接口（`/api/diagnose`）的另一个客户端，诊断规则、评分标准、prompt 全部仍由服务端统一维护。

## 使用方法

1. 在编辑器里选中一段稿件文本（建议 100–400 字）
2. 命令面板（`Cmd/Ctrl+Shift+P`）运行 **稿镜: 诊断选中文本**，或右键选中文本后在菜单里选
3. 依次选择文段类型、目标期刊（可留空）
4. 等待 10–40 秒，诊断结果会在右侧新开的面板里展示

## 本地开发

```bash
npm install
npm run compile   # 编译到 dist/extension.js
```

按 F5（或"运行扩展"）在新窗口里调试。

## 发布

```bash
npm install -g @vscode/vsce
vsce login <你的 publisher 名>
vsce package   # 生成 .vsix，可本地安装测试
vsce publish   # 发布到 VS Code 应用商店
```

发布前记得把 `package.json` 里的 `publisher` 字段换成你在 marketplace.visualstudio.com/manage 注册的真实 publisher id。

## 维护提示

`src/rubric.ts` 是手动从网页版 `gaojing/lib/rubric.ts` 同步过来的学科/文段类型/期刊列表——网页版那边改了选项（比如新增文段类型、调整期刊列表），这边需要手动同步一份，两边目前没有自动共享机制。
