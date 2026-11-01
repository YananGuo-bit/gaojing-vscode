import * as vscode from 'vscode';
import { DISCIPLINES, TARGET_JOURNALS, SECTIONS, getSection } from './rubric';

const API_BASE = 'https://kongyuxiao.vercel.app';

type Diagnosis = {
  tier_verdict: string;
  scores: Record<string, { score: number; comment: string }>;
  comments: { quote: string; issue: string; top_journal_practice: string }[];
  rewrite: string;
};

const ERROR_COPY: Record<string, string> = {
  rate_limited: '当前请求较多，请稍后再试。',
  invalid_json: 'AI 返回内容解析失败，请重试一次。',
  server_not_configured: '服务端尚未配置模型密钥，请联系管理员。',
  not_authenticated: '请先登录后再试。',
  invalid_request: '请求内容不符合要求，请检查选中文本。',
  upstream_unreachable: '无法连接到模型服务，请稍后重试。',
  upstream_error: '模型服务暂时出错，请稍后重试。',
};

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand('gaojing.diagnose', runDiagnose));
}

export function deactivate() {}

async function runDiagnose() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('稿镜：请先打开一个文件。');
    return;
  }
  const text = editor.document.getText(editor.selection).trim();
  if (text.length < 20) {
    vscode.window.showWarningMessage('稿镜：请先选中至少 20 个字符的稿件文本。');
    return;
  }

  const discipline = DISCIPLINES[0].value;

  const sectionPick = await vscode.window.showQuickPick(
    SECTIONS.map((s) => ({ label: s.label, key: s.key })),
    { placeHolder: '这段文字属于哪种文段类型？' },
  );
  if (!sectionPick) return;

  const journalItems: vscode.QuickPickItem[] = [
    { label: '不限定', detail: '按学科通行标准评判' },
    ...(TARGET_JOURNALS[discipline] ?? []).map((j) => ({ label: j })),
    { label: '其他（手动输入）' },
  ];
  const journalPick = await vscode.window.showQuickPick(journalItems, {
    placeHolder: '对标哪本目标期刊？（可不选）',
  });
  if (journalPick === undefined) return;

  let targetJournal = '';
  if (journalPick.label === '其他（手动输入）') {
    targetJournal = (await vscode.window.showInputBox({ prompt: '输入目标期刊名称' })) ?? '';
  } else if (journalPick.label !== '不限定') {
    targetJournal = journalPick.label;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '稿镜：AI 正在生成诊断…', cancellable: false },
    async () => {
      try {
        const res = await fetch(`${API_BASE}/api/diagnose`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discipline, tier: targetJournal, section: sectionPick.key, text }),
        });
        const data = (await res.json()) as Diagnosis & { error?: string };
        if (!res.ok) {
          const msg = ERROR_COPY[data?.error ?? ''] ?? `诊断请求失败（${data?.error ?? '未知错误'}），请重试。`;
          vscode.window.showErrorMessage(`稿镜：${msg}`);
          return;
        }
        showResultPanel(getSection(sectionPick.key).label, text, data as Diagnosis);
      } catch {
        vscode.window.showErrorMessage('稿镜：网络请求失败，请检查网络后重试。');
      }
    },
  );
}

function scoreColor(v: number): string {
  if (v >= 75) return '#3d7a5d';
  if (v >= 55) return '#9c7a25';
  return '#a63d2f';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showResultPanel(sectionLabel: string, originalText: string, d: Diagnosis) {
  const panel = vscode.window.createWebviewPanel('gaojingResult', `稿镜诊断 · ${sectionLabel}`, vscode.ViewColumn.Beside, {
    enableScripts: false,
  });

  const scoresHtml = Object.entries(d.scores ?? {})
    .map(([key, s]) => {
      const color = scoreColor(s.score);
      return `
        <div class="score-row">
          <div class="score-top"><span class="score-name">${esc(key)}</span><span class="score-num" style="color:${color}">${s.score}</span></div>
          <div class="score-track"><div class="score-fill" style="width:${Math.max(0, Math.min(100, s.score))}%;background:${color}"></div></div>
          <div class="score-comment">${esc(s.comment)}</div>
        </div>`;
    })
    .join('');

  const commentsHtml = (d.comments ?? [])
    .map(
      (c) => `
        <div class="comment-card">
          <div class="comment-quote">“${esc(c.quote)}”</div>
          <div class="comment-issue">${esc(c.issue)}</div>
          <div class="comment-practice"><b>目标期刊通常这样处理：</b>${esc(c.top_journal_practice)}</div>
        </div>`,
    )
    .join('');

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 20px; color: var(--vscode-foreground); line-height: 1.6; }
  h2 { font-size: 16px; margin-bottom: 4px; }
  .verdict { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); padding: 10px 13px; border-radius: 0 5px 5px 0; margin: 14px 0; }
  .score-row { margin-bottom: 14px; }
  .score-top { display: flex; justify-content: space-between; font-weight: 600; }
  .score-track { height: 6px; border-radius: 3px; background: var(--vscode-widget-border); overflow: hidden; margin: 4px 0; }
  .score-fill { height: 100%; }
  .score-comment { font-size: 13px; opacity: 0.85; }
  .comment-card { border-left: 3px solid var(--vscode-charts-orange); background: var(--vscode-textCodeBlock-background); border-radius: 0 6px 6px 0; padding: 10px 13px; margin-bottom: 10px; }
  .comment-quote { font-style: italic; margin-bottom: 5px; }
  .comment-issue { font-weight: 600; margin-bottom: 3px; }
  .comment-practice { font-size: 13px; opacity: 0.9; }
  .rewrite-box { background: var(--vscode-textCodeBlock-background); padding: 14px; border-radius: 6px; white-space: pre-line; }
  h3 { font-size: 14px; margin: 22px 0 8px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <h2>稿镜诊断结果 · ${esc(sectionLabel)}</h2>
  <div class="verdict">${esc(d.tier_verdict ?? '')}</div>
  <h3>评分</h3>
  ${scoresHtml}
  <h3>逐句批注</h3>
  ${commentsHtml}
  <h3>对照示范</h3>
  <div class="rewrite-box">${esc(d.rewrite ?? '')}</div>
</body>
</html>`;
}
