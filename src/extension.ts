import * as vscode from 'vscode';
import { DISCIPLINES, TARGET_JOURNALS, SECTIONS, getSection } from './rubric';

const API_BASE = 'https://kongyuxiao.vercel.app';
const HISTORY_KEY = 'gaojing.history';
const HISTORY_LIMIT = 50;

type Diagnosis = {
  tier_verdict: string;
  scores: Record<string, { score: number; comment: string }>;
  comments: { quote: string; issue: string; top_journal_practice: string }[];
  rewrite: string;
};

type HistoryItem = {
  id: string;
  time: string;
  discipline: string;
  sectionKey: string;
  journal: string;
  manuscript: string;
  data: Diagnosis;
};

const ERROR_COPY: Record<string, string> = {
  rate_limited: '当前请求较多，请稍后再试。',
  invalid_json: 'AI 返回内容解析失败，请重试一次。',
  server_not_configured: '服务端尚未配置模型密钥，请联系管理员。',
  not_authenticated: '请先登录后再试。',
  invalid_request: '请求内容不符合要求，请检查输入文本。',
  upstream_unreachable: '无法连接到模型服务，请稍后重试。',
  upstream_error: '模型服务暂时出错，请稍后重试。',
};

let sidebarProviderInstance: GaojingViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new GaojingViewProvider(context);
  sidebarProviderInstance = sidebarProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('gaojing.sidebarView', sidebarProvider),
    vscode.commands.registerCommand('gaojing.open', () => openInputPanel(context)),
    vscode.commands.registerCommand('gaojing.diagnose', () => diagnoseSelection(context)),
  );
}

export function deactivate() {}

function getHistory(context: vscode.ExtensionContext): HistoryItem[] {
  return context.globalState.get<HistoryItem[]>(HISTORY_KEY, []);
}

function addHistory(context: vscode.ExtensionContext, item: HistoryItem) {
  const next = [item, ...getHistory(context)].slice(0, HISTORY_LIMIT);
  context.globalState.update(HISTORY_KEY, next);
  sidebarProviderInstance?.refresh();
}

function deleteHistory(context: vscode.ExtensionContext, id: string) {
  const next = getHistory(context).filter((h) => h.id !== id);
  context.globalState.update(HISTORY_KEY, next);
  sidebarProviderInstance?.refresh();
}

function clearHistory(context: vscode.ExtensionContext) {
  context.globalState.update(HISTORY_KEY, []);
  sidebarProviderInstance?.refresh();
}

// 旧入口：对编辑器里已选中的文字直接诊断（适合已经在 Markdown 草稿里写好的情况）
async function diagnoseSelection(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('稿镜：请先打开一个文件并选中文字，或改用「稿镜: 打开诊断面板」。');
    return;
  }
  const text = editor.document.getText(editor.selection).trim();
  if (text.length < 20) {
    vscode.window.showWarningMessage('稿镜：请先选中至少 20 个字符的稿件文本。');
    return;
  }

  const disciplinePick = await vscode.window.showQuickPick(
    DISCIPLINES.filter((d) => d.enabled).map((d) => ({ label: d.label, value: d.value })),
    { placeHolder: '学科方向' },
  );
  if (!disciplinePick) return;

  const sectionPick = await vscode.window.showQuickPick(
    SECTIONS.map((s) => ({ label: s.label, key: s.key })),
    { placeHolder: '这段文字属于哪种文段类型？' },
  );
  if (!sectionPick) return;

  const targetJournal = await pickJournal(disciplinePick.value);
  if (targetJournal === undefined) return;

  const result = await callDiagnoseApi(disciplinePick.value, targetJournal, sectionPick.key, text);
  if (result.ok) {
    addHistory(context, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      discipline: disciplinePick.value,
      sectionKey: sectionPick.key,
      journal: targetJournal,
      manuscript: text,
      data: result.data,
    });
    showResultPanel(getSection(sectionPick.key).label, result.data);
  } else {
    vscode.window.showErrorMessage(`稿镜：${result.message}`);
  }
}

async function pickJournal(discipline: string): Promise<string | undefined> {
  const journalItems: vscode.QuickPickItem[] = [
    { label: '不限定', detail: '按学科通行标准评判' },
    ...(TARGET_JOURNALS[discipline] ?? []).map((j) => ({ label: j })),
    { label: '其他（手动输入）' },
  ];
  const journalPick = await vscode.window.showQuickPick(journalItems, {
    placeHolder: '对标哪本目标期刊？（可不选）',
  });
  if (journalPick === undefined) return undefined;
  if (journalPick.label === '其他（手动输入）') {
    return (await vscode.window.showInputBox({ prompt: '输入目标期刊名称' })) ?? '';
  }
  if (journalPick.label === '不限定') return '';
  return journalPick.label;
}

async function callDiagnoseApi(
  discipline: string,
  tier: string,
  section: string,
  text: string,
): Promise<{ ok: true; data: Diagnosis } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discipline, tier, section, text }),
    });
    const data = (await res.json()) as Diagnosis & { error?: string };
    if (!res.ok) {
      return { ok: false, message: ERROR_COPY[data?.error ?? ''] ?? `诊断请求失败（${data?.error ?? '未知错误'}），请重试。` };
    }
    return { ok: true, data: data as Diagnosis };
  } catch {
    return { ok: false, message: '网络请求失败，请检查网络后重试。' };
  }
}

// 侧边栏常驻入口：精简启动器 + 历史记录列表；真正的输入/结果在右侧主区域的宽面板里打开
class GaojingViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.render();
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'openPanel') {
        vscode.commands.executeCommand('gaojing.open');
      } else if (msg.command === 'openHistoryItem') {
        const item = getHistory(this.context).find((h) => h.id === msg.id);
        if (item) openInputPanel(this.context, item);
      } else if (msg.command === 'deleteHistoryItem') {
        deleteHistory(this.context, msg.id);
      } else if (msg.command === 'clearHistory') {
        if (getHistory(this.context).length === 0) return;
        clearHistory(this.context);
      }
    });
  }

  refresh() {
    this.render();
  }

  private render() {
    if (!this.view) return;
    this.view.webview.html = getLauncherHtml(getHistory(this.context));
  }
}

function getLauncherHtml(history: HistoryItem[]): string {
  const itemsHtml = history
    .map((h) => {
      const preview = h.manuscript.slice(0, 40) + (h.manuscript.length > 40 ? '…' : '');
      const time = new Date(h.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="hist-item" data-id="${esc(h.id)}">
          <div class="hist-row">
            <span class="hist-meta">${esc(time)} · ${esc(getSection(h.sectionKey).label)}</span>
            <span class="hist-del" data-id="${esc(h.id)}" title="删除">✕</span>
          </div>
          <div class="hist-preview">${esc(preview)}</div>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 12px; color: var(--vscode-foreground); line-height: 1.5; }
  button.primary { padding: 8px 10px; font-size: 12.5px; font-weight: 600; border-radius: 4px; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; width: 100%; margin-bottom: 14px; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .section-label { font-size: 10.5px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; margin: 10px 0 6px; display: flex; justify-content: space-between; align-items: center; }
  .clear-link { font-size: 10.5px; opacity: 0.6; cursor: pointer; text-decoration: underline; }
  .clear-link:hover { opacity: 1; }
  .empty { font-size: 11.5px; opacity: 0.55; padding: 6px 2px; }
  .hist-item { padding: 7px 8px; border-radius: 4px; cursor: pointer; margin-bottom: 3px; }
  .hist-item:hover { background: var(--vscode-list-hoverBackground); }
  .hist-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
  .hist-meta { font-size: 10.5px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hist-del { font-size: 11px; opacity: 0; cursor: pointer; flex-shrink: 0; }
  .hist-item:hover .hist-del { opacity: 0.5; }
  .hist-del:hover { opacity: 1 !important; }
  .hist-preview { font-size: 12px; opacity: 0.85; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
  <button class="primary" id="openBtn">+ 新建诊断</button>
  <div class="section-label">
    <span>历史记录</span>
    ${history.length > 0 ? '<span class="clear-link" id="clearBtn">清空</span>' : ''}
  </div>
  ${history.length === 0 ? '<div class="empty">还没有诊断记录</div>' : itemsHtml}
<script>
  const vscodeApi = acquireVsCodeApi();
  document.getElementById('openBtn').addEventListener('click', () => {
    vscodeApi.postMessage({ command: 'openPanel' });
  });
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscodeApi.postMessage({ command: 'clearHistory' });
    });
  }
  document.querySelectorAll('.hist-item').forEach((el) => {
    el.addEventListener('click', () => {
      vscodeApi.postMessage({ command: 'openHistoryItem', id: el.getAttribute('data-id') });
    });
  });
  document.querySelectorAll('.hist-del').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      vscodeApi.postMessage({ command: 'deleteHistoryItem', id: el.getAttribute('data-id') });
    });
  });
</script>
</body>
</html>`;
}

// 新入口（独立编辑器标签页版本，空间更大）：自带可换行的文本框，不依赖编辑器的 word wrap 设置
// prefill 不为空时，用于从历史记录里回看某一次诊断
function openInputPanel(context: vscode.ExtensionContext, prefill?: HistoryItem) {
  const panel = vscode.window.createWebviewPanel('gaojingInput', '稿镜：诊断面板', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = getInputPanelHtml(prefill);
  wireMessages(panel.webview, context);
}

function wireMessages(webview: vscode.Webview, context: vscode.ExtensionContext) {
  webview.onDidReceiveMessage(async (msg) => {
    if (msg.command !== 'diagnose') return;
    const result = await callDiagnoseApi(msg.discipline, msg.journal ?? '', msg.section, msg.text);
    if (!result.ok) {
      webview.postMessage({ command: 'error', message: result.message });
      return;
    }
    addHistory(context, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      discipline: msg.discipline,
      sectionKey: msg.section,
      journal: msg.journal ?? '',
      manuscript: msg.text,
      data: result.data,
    });
    webview.postMessage({ command: 'result', html: renderResultHtml(result.data) });
  });
}

function getInputPanelHtml(prefill?: HistoryItem): string {
  const disciplineOptions = DISCIPLINES.map(
    (d) =>
      `<option value="${esc(d.value)}" ${d.enabled ? '' : 'disabled'} ${prefill?.discipline === d.value ? 'selected' : ''}>${esc(d.label)}</option>`,
  ).join('');
  const sectionOptions = SECTIONS.map(
    (s) => `<option value="${s.key}" ${prefill?.sectionKey === s.key ? 'selected' : ''}>${esc(s.label)}</option>`,
  ).join('');
  const prefillManuscript = prefill ? esc(prefill.manuscript) : '';
  const prefillResultHtml = prefill ? renderResultHtml(prefill.data) : '';
  const prefillJournalJson = JSON.stringify(prefill?.journal ?? '');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 16px; color: var(--vscode-foreground); line-height: 1.6; max-width: 760px; }
  h2 { font-size: 15px; margin-bottom: 4px; }
  .hint { font-size: 11.5px; opacity: 0.7; margin-bottom: 14px; }
  label { display: block; font-size: 11.5px; opacity: 0.8; margin: 12px 0 4px; }
  textarea, select, input[type="text"] {
    width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; padding: 7px 9px;
  }
  textarea { min-height: 180px; resize: vertical; white-space: pre-wrap; }
  .row { display: flex; gap: 14px; }
  .row > div { flex: 1; }
  button { margin-top: 16px; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 4px; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; width: 100%; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  #status { margin-top: 10px; font-size: 12px; opacity: 0.8; }
  #result { margin-top: 22px; border-top: 1px solid var(--vscode-widget-border); padding-top: 16px; }
  .verdict { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); padding: 9px 12px; border-radius: 0 5px 5px 0; margin: 12px 0; font-size: 13px; }
  .score-row { margin-bottom: 12px; }
  .score-top { display: flex; justify-content: space-between; font-weight: 600; font-size: 13px; }
  .score-track { height: 6px; border-radius: 3px; background: var(--vscode-widget-border); overflow: hidden; margin: 4px 0; }
  .score-fill { height: 100%; }
  .score-comment { font-size: 12px; opacity: 0.85; }
  .comment-card { border-left: 3px solid var(--vscode-charts-orange); background: var(--vscode-textCodeBlock-background); border-radius: 0 6px 6px 0; padding: 9px 12px; margin-bottom: 9px; font-size: 12.5px; }
  .comment-quote { font-style: italic; margin-bottom: 4px; }
  .comment-issue { font-weight: 600; margin-bottom: 3px; }
  .comment-practice { opacity: 0.9; }
  .rewrite-box { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 6px; white-space: pre-line; font-size: 12.5px; }
  h3 { font-size: 11.5px; margin: 18px 0 7px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <h2>稿镜 · 写作诊断${prefill ? '（历史记录）' : ''}</h2>
  <div class="hint">把稿件片段粘贴或直接打在下面，选好学科、文段类型和目标期刊，点"开始诊断"。</div>

  <label>学科方向</label>
  <select id="discipline">${disciplineOptions}</select>

  <label>稿件文本（建议 100–400 字）</label>
  <textarea id="manuscript" placeholder="在此粘贴或输入你的论文段落……">${prefillManuscript}</textarea>

  <div class="row">
    <div>
      <label>文段类型</label>
      <select id="section">${sectionOptions}</select>
    </div>
    <div>
      <label>目标期刊</label>
      <select id="journal"></select>
      <input type="text" id="journalCustom" placeholder="输入目标期刊名称" style="display:none; margin-top:6px;">
    </div>
  </div>

  <button id="submitBtn">开始诊断</button>
  <div id="status"></div>
  <div id="result">${prefillResultHtml}</div>

<script>
  const vscodeApi = acquireVsCodeApi();
  const TARGET_JOURNALS = ${JSON.stringify(TARGET_JOURNALS)};
  const PREFILL_JOURNAL = ${prefillJournalJson};

  const disciplineSelect = document.getElementById('discipline');
  const journalSelect = document.getElementById('journal');
  const journalCustom = document.getElementById('journalCustom');

  function refreshJournals() {
    const list = TARGET_JOURNALS[disciplineSelect.value] || [];
    journalSelect.innerHTML = '<option value="">不限定（按学科通行标准）</option>'
      + list.map(j => '<option value="' + j.replace(/"/g,'&quot;') + '">' + j + '</option>').join('')
      + '<option value="__custom__">其他（手动输入）</option>';
    if (PREFILL_JOURNAL) {
      if (list.includes(PREFILL_JOURNAL)) {
        journalSelect.value = PREFILL_JOURNAL;
      } else {
        journalSelect.value = '__custom__';
        journalCustom.style.display = 'block';
        journalCustom.value = PREFILL_JOURNAL;
      }
    } else {
      journalCustom.style.display = 'none';
    }
  }
  disciplineSelect.addEventListener('change', refreshJournals);
  refreshJournals();

  journalSelect.addEventListener('change', () => {
    journalCustom.style.display = journalSelect.value === '__custom__' ? 'block' : 'none';
  });

  const btn = document.getElementById('submitBtn');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');

  btn.addEventListener('click', () => {
    const text = document.getElementById('manuscript').value.trim();
    if (text.length < 20) {
      statusEl.textContent = '请先输入至少 20 个字符的稿件文本。';
      return;
    }
    const discipline = disciplineSelect.value;
    const section = document.getElementById('section').value;
    let journal = journalSelect.value;
    if (journal === '__custom__') journal = journalCustom.value.trim();
    btn.disabled = true;
    statusEl.textContent = 'AI 正在生成诊断…（通常需要 10–40 秒）';
    resultEl.innerHTML = '';
    vscodeApi.postMessage({ command: 'diagnose', discipline, text, section, journal });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    btn.disabled = false;
    if (msg.command === 'error') {
      statusEl.textContent = msg.message;
      return;
    }
    if (msg.command === 'result') {
      statusEl.textContent = '';
      resultEl.innerHTML = msg.html;
    }
  });
</script>
</body>
</html>`;
}

function scoreColor(v: number): string {
  if (v >= 75) return '#3d7a5d';
  if (v >= 55) return '#9c7a25';
  return '#a63d2f';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderResultHtml(d: Diagnosis): string {
  const scoresHtml = Object.entries(d.scores ?? {})
    .map(([key, s]) => {
      const color = scoreColor(s.score);
      return `
        <div class="score-row">
          <div class="score-top"><span>${esc(key)}</span><span style="color:${color}">${s.score}</span></div>
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

  return `
    <div class="verdict">${esc(d.tier_verdict ?? '')}</div>
    <h3>评分</h3>
    ${scoresHtml}
    <h3>逐句批注</h3>
    ${commentsHtml}
    <h3>对照示范</h3>
    <div class="rewrite-box">${esc(d.rewrite ?? '')}</div>
  `;
}

// 旧的独立结果面板，仍供「诊断选中文本」命令使用
function showResultPanel(sectionLabel: string, d: Diagnosis) {
  const panel = vscode.window.createWebviewPanel('gaojingResult', `稿镜诊断 · ${sectionLabel}`, vscode.ViewColumn.Beside, {
    enableScripts: false,
  });
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
  ${renderResultHtml(d)}
</body>
</html>`;
}
