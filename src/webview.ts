import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runPipeline } from './promptPipeline';
import { getNonce, escapeHtml, mapErrorToUiError, redactSensitiveData } from './utils';
import { AgentInstructionSyncService } from './agentSync';
import { WorkspaceIndexer } from './workspace';
import { ProviderConfigManager } from './providerConfig';
import { ProviderFactory } from './providers';

export class PromptRefinerPanel {
    public static currentPanel: PromptRefinerPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, initialText?: string) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, initialText);

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'refinePrompt':
                        try {
                            this.panel.webview.postMessage({ command: 'clearResult' });
                            const refined = await runPipeline(
                                message.text, 
                                context,
                                (progressEvent) => {
                                    this.panel.webview.postMessage({ command: 'progressUpdate', event: progressEvent });
                                },
                                (token) => {
                                    this.panel.webview.postMessage({ command: 'token', data: token });
                                }
                            );
                            this.panel.webview.postMessage({ command: 'refinementComplete', result: refined });
                        } catch (err: any) {
                            const uiError = mapErrorToUiError(err);
                            uiError.details = redactSensitiveData(uiError.details || err.message);
                            this.panel.webview.postMessage({ command: 'refinementError', error: uiError });
                        }
                        return;
                    case 'configureProvider':
                        vscode.commands.executeCommand('contextforge.configureProvider');
                        return;
                    case 'configureSearxng':
                        vscode.commands.executeCommand('workbench.action.openSettings', 'contextforge.searxng.baseUrl');
                        return;
                        case 'previewSync':
                            try {
                                const indexer = new WorkspaceIndexer();
                                const summary = await indexer.summarizeWorkspace();
                                const syncService = new AgentInstructionSyncService();
                                const results = await syncService.sync(message.text, summary, true); // dryRun = true
                                this.panel.webview.postMessage({ command: 'syncPreviewResults', results });
                        } catch (e: any) {
                            vscode.window.showErrorMessage('Error during preview: ' + e.message);
                        }
                        return;
                        case 'confirmSync':
                            try {
                                const indexer = new WorkspaceIndexer();
                                const summary = await indexer.summarizeWorkspace();
                                const syncService = new AgentInstructionSyncService();
                                await syncService.sync(message.text, summary, false); // dryRun = false
                                this.panel.webview.postMessage({ command: 'syncComplete' });
                        } catch (e: any) {
                            vscode.window.showErrorMessage('Error during sync: ' + e.message);
                        }
                        return;
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(context: vscode.ExtensionContext, initialText?: string) {
        const extensionUri = context.extensionUri;
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (PromptRefinerPanel.currentPanel) {
            PromptRefinerPanel.currentPanel.panel.reveal(column);
            if (initialText) {
                PromptRefinerPanel.currentPanel.panel.webview.postMessage({ command: 'setText', text: initialText });
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'promptRefiner',
            'ContextForge: Refine Prompt',
            column || vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [extensionUri] }
        );

        PromptRefinerPanel.currentPanel = new PromptRefinerPanel(panel, context, initialText);
    }

    public dispose() {
        PromptRefinerPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, initialText?: string) {
        const nonce = getNonce();
        const safeInitialText = escapeHtml(initialText || '');
        
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Prompt Refiner</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
                    textarea { width: 100%; min-height: 150px; margin-bottom: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px; font-family: inherit; resize: vertical; }
                    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; margin-right: 8px; margin-bottom: 10px; border-radius: 2px; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                    .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
                    
                    #result-container { flex: 1; display: none; flex-direction: column; overflow: hidden; margin-top: 10px; }
                    #result {
                        white-space: pre-wrap;
                        font-family: var(--vscode-editor-font-family);
                        line-height: 1.5;
                        padding: 10px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                        overflow-x: auto;
                        min-height: 50px;
                    }
                    .streaming-cursor::after {
                        content: '|';
                        animation: blink 1s step-end infinite;
                        font-weight: bold;
                        color: var(--vscode-button-background);
                    }
                    @keyframes blink {
                        from, to { opacity: 1; }
                        50% { opacity: 0; }
                    }
                </style>
                    /* Progress UI */
                    #progress-container { display: none; margin-top: 20px; border: 1px solid var(--vscode-widget-border); padding: 15px; border-radius: 4px; background: var(--vscode-editor-background); }
                    .progress-step { display: flex; align-items: center; margin-bottom: 8px; font-size: 13px; }
                    .progress-icon { width: 16px; height: 16px; margin-right: 10px; display: inline-block; border-radius: 50%; }
                    .status-pending .progress-icon { border: 2px solid var(--vscode-descriptionForeground); }
                    .status-running .progress-icon { border: 2px solid var(--vscode-progressBar-background); border-top-color: transparent; animation: spin 1s linear infinite; }
                    .status-done .progress-icon { background: var(--vscode-testing-iconPassed); }
                    .status-error .progress-icon { background: var(--vscode-testing-iconFailed); }
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                    
                    /* Error UI */
                    #error-container { display: none; margin-top: 20px; border: 1px solid var(--vscode-testing-iconFailed); padding: 15px; border-radius: 4px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
                    #error-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; }
                    #error-message { margin-bottom: 15px; font-size: 13px; line-height: 1.4; }
                    #error-actions { display: flex; gap: 8px; flex-wrap: wrap; }
                    #error-details-container { margin-top: 15px; }
                </style>
            </head>
            <body>
                <h3>Basic Prompt</h3>
                <textarea id="prompt-input" placeholder="Type your basic prompt here...">${safeInitialText}</textarea>
                <div>
                    <button id="refine-btn">Refine Prompt</button>
                    <button id="copy-btn" style="display: none;">Copy Result</button>
                </div>
                
                <div id="progress-container">
                    <div id="steps-list"></div>
                </div>

                <div id="error-container">
                    <div id="error-title"></div>
                    <div id="error-message"></div>
                    <div id="error-actions"></div>
                    <div id="error-details-container" style="display: none;">
                        <button id="copy-diagnostics-btn" class="secondary-btn">Copy Diagnostics</button>
                    </div>
                </div>
                
                <div id="result-container">
                    <h3>Refined Prompt</h3>
                    <div id="result"></div>
                    <div style="margin-top: 10px;">
                        <button id="preview-sync-btn" class="secondary-btn">Preview Sync</button>
                        <button id="confirm-sync-btn" style="display: none;">Confirm Sync</button>
                    </div>
                    <div id="sync-preview-container" style="display: none; margin-top: 10px; padding: 10px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px;">
                        <div style="font-weight: bold; margin-bottom: 5px;">Files to be modified:</div>
                        <ul id="sync-preview-list" style="margin: 0; padding-left: 20px; font-size: 13px;"></ul>
                    </div>
                </div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    let currentDiagnosticDetails = '';
                    
                    const progressSteps = {};

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'setText':
                                document.getElementById('prompt-input').value = message.text;
                                break;
                            case 'progressUpdate':
                                updateProgress(message.event);
                                break;
                            case 'clearResult':
                                document.getElementById('result').textContent = '';
                                document.getElementById('result-container').style.display = 'flex';
                                document.getElementById('result').classList.add('streaming-cursor');
                                document.getElementById('copy-btn').style.display = 'none';
                                break;
                            case 'token':
                                const resEl = document.getElementById('result');
                                resEl.textContent += message.data;
                                // Auto scroll to bottom
                                resEl.scrollTop = resEl.scrollHeight;
                                break;
                            case 'refinementComplete':
                                document.getElementById('result-container').style.display = 'flex';
                                document.getElementById('result').textContent = message.result;
                                document.getElementById('result').classList.remove('streaming-cursor');
                                document.getElementById('copy-btn').style.display = 'inline-block';
                                document.getElementById('refine-btn').disabled = false;
                                document.getElementById('sync-preview-container').style.display = 'none';
                                document.getElementById('confirm-sync-btn').style.display = 'none';
                                break;
                            case 'refinementError':
                                document.getElementById('result').classList.remove('streaming-cursor');
                                showError(message.error);
                                document.getElementById('refine-btn').disabled = false;
                                break;
                            case 'syncPreviewResults':
                                const list = document.getElementById('sync-preview-list');
                                list.innerHTML = '';
                                message.results.forEach(res => {
                                    const li = document.createElement('li');
                                    li.textContent = \`[\${res.action}] \${res.filePaths[0]}\`;
                                    list.appendChild(li);
                                });
                                document.getElementById('sync-preview-container').style.display = 'block';
                                document.getElementById('confirm-sync-btn').style.display = 'inline-block';
                                break;
                            case 'syncComplete':
                                document.getElementById('sync-preview-container').style.display = 'none';
                                document.getElementById('confirm-sync-btn').style.display = 'none';
                                document.getElementById('preview-sync-btn').textContent = 'Synced ✓';
                                setTimeout(() => { document.getElementById('preview-sync-btn').textContent = 'Preview Sync'; }, 3000);
                                break;
                        }
                    });

                    function updateProgress(event) {
                        const container = document.getElementById('progress-container');
                        container.style.display = 'block';
                        
                        const list = document.getElementById('steps-list');
                        let stepEl = document.getElementById('step-' + event.step);
                        
                        if (!stepEl) {
                            stepEl = document.createElement('div');
                            stepEl.id = 'step-' + event.step;
                            stepEl.className = 'progress-step status-' + event.status;
                            
                            const icon = document.createElement('div');
                            icon.className = 'progress-icon';
                            
                            const label = document.createElement('span');
                            label.className = 'progress-label';
                            label.textContent = event.label;
                            
                            stepEl.appendChild(icon);
                            stepEl.appendChild(label);
                            list.appendChild(stepEl);
                        } else {
                            stepEl.className = 'progress-step status-' + event.status;
                            if (event.message) {
                                stepEl.querySelector('.progress-label').textContent = event.label + ': ' + event.message;
                            }
                        }
                    }

                    function showError(error) {
                        document.getElementById('error-container').style.display = 'block';
                        document.getElementById('error-title').textContent = error.title;
                        document.getElementById('error-message').textContent = error.message;
                        
                        const actionsContainer = document.getElementById('error-actions');
                        actionsContainer.innerHTML = '';
                        
                        if (error.actions && error.actions.length > 0) {
                            error.actions.forEach(action => {
                                const btn = document.createElement('button');
                                btn.textContent = action.label;
                                btn.onclick = () => handleAction(action.id);
                                actionsContainer.appendChild(btn);
                            });
                        }
                        
                        if (error.details) {
                            currentDiagnosticDetails = error.details;
                            document.getElementById('error-details-container').style.display = 'block';
                        } else {
                            document.getElementById('error-details-container').style.display = 'none';
                        }
                    }

                    function handleAction(actionId) {
                        if (actionId === 'retry') {
                            document.getElementById('refine-btn').click();
                        } else if (actionId === 'configureProvider') {
                            vscode.postMessage({ command: 'configureProvider' });
                        } else if (actionId === 'configureSearxng') {
                            vscode.postMessage({ command: 'configureSearxng' });
                        }
                    }

                    document.getElementById('refine-btn').addEventListener('click', () => {
                        const text = document.getElementById('prompt-input').value;
                        if (!text.trim()) return;
                        
                        // Reset UI
                        document.getElementById('error-container').style.display = 'none';
                        document.getElementById('result-container').style.display = 'none';
                        document.getElementById('copy-btn').style.display = 'none';
                        document.getElementById('steps-list').innerHTML = '';
                        document.getElementById('refine-btn').disabled = true;
                        
                        vscode.postMessage({ command: 'refinePrompt', text });
                    });

                    document.getElementById('copy-btn').addEventListener('click', () => {
                        const resultText = document.getElementById('result').textContent;
                        navigator.clipboard.writeText(resultText);
                    });

                    document.getElementById('copy-diagnostics-btn').addEventListener('click', () => {
                        navigator.clipboard.writeText(currentDiagnosticDetails);
                    });

                    document.getElementById('preview-sync-btn').addEventListener('click', () => {
                        const resultText = document.getElementById('result').textContent;
                        vscode.postMessage({ command: 'previewSync', text: resultText });
                    });

                    document.getElementById('confirm-sync-btn').addEventListener('click', () => {
                        const resultText = document.getElementById('result').textContent;
                        vscode.postMessage({ command: 'confirmSync', text: resultText });
                    });
                </script>
            </body>
            </html>`;
    }
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    public view?: vscode.WebviewView;

    constructor(private readonly extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'analyzeWorkspace':
                    try {
                        const vscodeWs = vscode.workspace;
                        if (!vscodeWs.workspaceFolders || vscodeWs.workspaceFolders.length === 0) {
                            webviewView.webview.postMessage({ command: 'updateStatus', error: 'No workspace folder open.' });
                            break;
                        }
                        const rootPath = vscodeWs.workspaceFolders[0].uri.fsPath;
                        const wsName = vscodeWs.workspaceFolders[0].name;
                        const uris = await vscodeWs.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**}', 500);
                        const fileCount = uris.length;

                        const keyFiles = ['package.json','tsconfig.json','pyproject.toml','requirements.txt',
                            'Cargo.toml','go.mod','Dockerfile','docker-compose.yml','README.md','.env'];
                        const foundKeys: string[] = [];
                        for (const kf of keyFiles) {
                            if (fs.existsSync(path.join(rootPath, kf))) { foundKeys.push(kf); }
                        }

                        // Get top-level dirs
                        const dirs = new Set<string>();
                        for (const uri of uris) {
                            const rel = path.relative(rootPath, uri.fsPath);
                            const parts = rel.split(path.sep);
                            if (parts.length > 1) { dirs.add(parts[0]); }
                        }

                        webviewView.webview.postMessage({
                            command: 'updateStatus',
                            data: {
                                name: wsName,
                                fileCount,
                                keyFiles: foundKeys,
                                dirs: Array.from(dirs).sort().slice(0, 8)
                            }
                        });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'updateStatus', error: e.message });
                    }
                    break;
                case 'configureProvider':
                    vscode.commands.executeCommand('contextforge.configureProvider');
                    break;
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>ContextForge Status</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 10px; font-size: 12px; }
                    .section { margin-bottom: 16px; }
                    .title { font-weight: bold; margin-bottom: 8px; font-size: 13px; color: var(--vscode-foreground); }
                    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px; font-size: 12px; width: 100%; margin-top: 8px; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    button:disabled { opacity: 0.5; cursor: not-allowed; }
                    .info-card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 8px; margin-bottom: 8px; }
                    .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                    .info-label { color: var(--vscode-descriptionForeground); }
                    .info-value { font-weight: bold; color: var(--vscode-foreground); }
                    .tag-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
                    .tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; padding: 1px 5px; font-size: 10px; }
                    .status-text { color: var(--vscode-descriptionForeground); font-style: italic; }
                    .error-text { color: var(--vscode-errorForeground); }
                </style>
            </head>
            <body>
                <div class="section">
                    <div class="title">Workspace</div>
                    <div id="workspace-status" class="status-text">Click Analyze to inspect your project.</div>
                    <div id="workspace-card" style="display:none">
                        <div class="info-card">
                            <div class="info-row">
                                <span class="info-label">Project</span>
                                <span class="info-value" id="ws-name">-</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Files Found</span>
                                <span class="info-value" id="ws-files">-</span>
                            </div>
                        </div>
                        <div style="color:var(--vscode-descriptionForeground); margin-bottom:4px;">Key Files</div>
                        <div class="tag-list" id="ws-keyfiles"></div>
                        <div style="color:var(--vscode-descriptionForeground); margin-top:8px; margin-bottom:4px;">Directories</div>
                        <div class="tag-list" id="ws-dirs"></div>
                    </div>
                    <button id="analyze-btn">🔍 Analyze Workspace</button>
                </div>
                <div class="section">
                    <div class="title">Provider</div>
                    <div id="provider-status" class="status-text" style="margin-bottom: 8px;">Not configured.</div>
                    <button id="config-btn">⚙️ Configure Provider</button>
                </div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    document.getElementById('analyze-btn').addEventListener('click', () => {
                        document.getElementById('analyze-btn').innerText = '⏳ Analyzing...';
                        document.getElementById('analyze-btn').disabled = true;
                        document.getElementById('workspace-status').className = 'status-text';
                        document.getElementById('workspace-status').innerText = 'Scanning workspace files...';
                        document.getElementById('workspace-card').style.display = 'none';
                        vscode.postMessage({ command: 'analyzeWorkspace' });
                    });
                    document.getElementById('config-btn').addEventListener('click', () => {
                        vscode.postMessage({ command: 'configureProvider' });
                    });
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'updateStatus') {
                            const btn = document.getElementById('analyze-btn');
                            btn.innerText = '🔍 Re-analyze';
                            btn.disabled = false;
                            if (message.error) {
                                document.getElementById('workspace-status').className = 'error-text';
                                document.getElementById('workspace-status').innerText = '❌ ' + message.error;
                                document.getElementById('workspace-card').style.display = 'none';
                            } else if (message.data) {
                                const escapeHtml = (unsafe) => unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                                const d = message.data;
                                document.getElementById('workspace-status').innerText = '';
                                document.getElementById('ws-name').innerText = d.name;
                                document.getElementById('ws-files').innerText = d.fileCount;
                                const kfEl = document.getElementById('ws-keyfiles');
                                kfEl.innerHTML = d.keyFiles.length ? d.keyFiles.map(f => '<span class="tag">' + escapeHtml(f) + '</span>').join('') : '<span class="status-text">None found</span>';
                                const dirEl = document.getElementById('ws-dirs');
                                dirEl.innerHTML = d.dirs.length ? d.dirs.map(f => '<span class="tag">' + escapeHtml(f) + '</span>').join('') : '<span class="status-text">None</span>';
                                document.getElementById('workspace-card').style.display = 'block';
                            }
                        }
                        if (message.command === 'updateProvider') {
                            document.getElementById('provider-status').innerText = message.name || 'Configured';
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}

export class ProviderConfigPanel {
    public static currentPanel: ProviderConfigPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private context: vscode.ExtensionContext;

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.context = context;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.render();

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'testAndSave':
                        await this.testAndSaveProvider(message.config, message.apiKey);
                        return;
                    case 'saveAnyway':
                        await this.saveProvider(message.config, message.apiKey);
                        return;
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (ProviderConfigPanel.currentPanel) {
            ProviderConfigPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'providerConfig',
            'ContextForge: Configure Provider',
            column || vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [context.extensionUri] }
        );

        ProviderConfigPanel.currentPanel = new ProviderConfigPanel(panel, context);
    }

    public refresh() {
        this.render();
    }

    private async render() {
        const state = await ProviderConfigManager.getWorkspaceState();
        let activeConfig = null;
        if (state && state.activeProviderId) {
            activeConfig = state.providers.find((p: any) => p.id === state.activeProviderId);
        }
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, activeConfig);
    }

    private async testAndSaveProvider(config: any, apiKey: string) {
        try {
            // Temporarily save key to test
            if (apiKey) {
                await ProviderConfigManager.setApiKey(this.context, config.id, apiKey);
            }

            // Instantiate to test
            const provider = ProviderFactory.createProviderFromConfig(config);
            this.panel.webview.postMessage({ command: 'testing' });
            
            const result = await provider.healthCheck(this.context);
            if (result.status === 'working') {
                await this.saveProvider(config, apiKey);
            } else {
                this.panel.webview.postMessage({ command: 'testFailed', result });
            }
        } catch (e: any) {
            this.panel.webview.postMessage({ command: 'testFailed', result: { status: 'error', message: e.message } });
        }
    }

    private async saveProvider(config: any, apiKey: string) {
        try {
            if (apiKey) {
                await ProviderConfigManager.setApiKey(this.context, config.id, apiKey);
            }

            let state = await ProviderConfigManager.getWorkspaceState();
            if (!state) {
                state = { schemaVersion: 1, activeProviderId: config.id, providers: [] };
            }
            
            const idx = state.providers.findIndex((p: any) => p.id === config.id);
            if (idx >= 0) {
                state.providers[idx] = config;
            } else {
                state.providers.push(config);
            }
            state.activeProviderId = config.id;
            
            await ProviderConfigManager.saveWorkspaceState(state);
            this.panel.webview.postMessage({ command: 'saveSuccess' });
            vscode.window.showInformationMessage('Provider configuration saved successfully.');
        } catch (e: any) {
            vscode.window.showErrorMessage('Failed to save provider: ' + e.message);
        }
    }

    public dispose() {
        ProviderConfigPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, activeConfig: any) {
        const nonce = getNonce();
        const initConfig = activeConfig || { type: 'native', adapterId: 'gemini', id: 'default-gemini', displayName: 'Gemini', model: 'gemini-2.0-flash' };
        const initConfigJson = JSON.stringify(initConfig).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Configure Provider</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; max-width: 800px; margin: 0 auto; color: var(--vscode-foreground); }
                    .form-group { margin-bottom: 15px; }
                    label { display: block; margin-bottom: 5px; font-weight: 600; }
                    input, select, textarea { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); box-sizing: border-box; }
                    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; border-radius: 2px; font-weight: bold; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 10px; }
                    .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
                    .preset-btn { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px; padding: 4px 8px; border: none; cursor: pointer; margin-right: 5px; margin-bottom: 10px; border-radius: 10px; }
                    .hidden { display: none; }
                    .section { border: 1px solid var(--vscode-widget-border); padding: 15px; border-radius: 4px; margin-top: 15px; background: var(--vscode-editor-background); }
                    #status-msg { margin-top: 15px; padding: 10px; border-radius: 4px; display: none; }
                    .status-working { background: var(--vscode-testing-iconPassed); color: white; }
                    .status-error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
                </style>
            </head>
            <body>
                <h2>Provider Configuration</h2>
                
                <div class="form-group">
                    <label>Provider Type</label>
                    <select id="providerType">
                        <option value="native">Native Built-in (Gemini, Anthropic)</option>
                        <option value="openai-compatible">OpenAI-Compatible (Groq, DeepSeek, Local)</option>
                        <option value="generic-http">Generic HTTP (Custom APIs)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" id="displayName" value="">
                    <input type="hidden" id="providerId" value="">
                </div>

                <!-- NATIVE FIELDS -->
                <div id="native-fields" class="section hidden">
                    <div class="form-group">
                        <label>Adapter</label>
                        <select id="nativeAdapterId">
                            <option value="gemini">Gemini</option>
                            <option value="anthropic">Anthropic (Claude)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Model</label>
                        <input type="text" id="nativeModel" value="" placeholder="e.g. gemini-2.0-flash or claude-3-5-sonnet-20240620">
                    </div>
                </div>

                <!-- OPENAI COMPATIBLE FIELDS -->
                <div id="openai-fields" class="section hidden">
                    <div>
                        <button class="preset-btn" onclick="applyPreset('groq')">Groq Preset</button>
                        <button class="preset-btn" onclick="applyPreset('openai')">OpenAI Preset</button>
                    </div>
                    <div class="form-group">
                        <label>Base URL</label>
                        <input type="text" id="openAiBaseUrl" value="" placeholder="https://api.openai.com/v1">
                    </div>
                    <div class="form-group">
                        <label>Endpoint Path</label>
                        <input type="text" id="openAiEndpoint" value="">
                    </div>
                    <div class="form-group">
                        <label>Model</label>
                        <input type="text" id="openAiModel" value="" placeholder="e.g. gpt-4o">
                    </div>
                    <div class="form-group">
                        <label>Auth Type</label>
                        <select id="openAiAuthType">
                            <option value="bearer">Bearer Token</option>
                            <option value="x-api-key">x-api-key Header</option>
                            <option value="none">None</option>
                        </select>
                    </div>
                </div>

                <!-- GENERIC HTTP FIELDS -->
                <div id="generic-fields" class="section hidden">
                    <p style="font-size:12px; color:var(--vscode-descriptionForeground);">Template vars: {{apiKey}}, {{model}}, {{systemPrompt}}, {{userPrompt}}, {{maxTokens}}, {{temperature}}</p>
                    <div class="form-group">
                        <label>URL</label>
                        <input type="text" id="genericUrl" value="" placeholder="https://custom.api/v1/generate">
                    </div>
                    <div class="form-group">
                        <label>Method</label>
                        <select id="genericMethod">
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Headers (JSON)</label>
                        <textarea id="genericHeaders" rows="3"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Body Template (JSON string with vars)</label>
                        <textarea id="genericBody" rows="6"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Response Text Path</label>
                        <input type="text" id="genericResponsePath" value="" placeholder="e.g. choices.0.message.content">
                    </div>
                    <div class="form-group">
                        <label>Model (Optional)</label>
                        <input type="text" id="genericModel" value="">
                    </div>
                </div>

                <div class="section">
                    <div class="form-group">
                        <label>API Key (Stored securely in VS Code SecretStorage)</label>
                        <input type="password" id="apiKey" placeholder="Leave blank to keep existing key">
                    </div>
                </div>

                <div style="margin-top: 20px;">
                    <button id="test-btn">Test & Save Provider</button>
                    <button id="save-anyway-btn" class="secondary-btn hidden">Force Save Anyway</button>
                </div>
                
                <div id="status-msg"></div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    const initConfig = ${initConfigJson};
                    
                    document.getElementById('providerType').value = initConfig.type || 'native';
                    document.getElementById('displayName').value = initConfig.displayName || '';
                    document.getElementById('providerId').value = initConfig.id || '';
                    
                    if (initConfig.type === 'native') {
                        document.getElementById('nativeAdapterId').value = initConfig.adapterId || 'gemini';
                        document.getElementById('nativeModel').value = initConfig.model || '';
                    } else if (initConfig.type === 'openai-compatible') {
                        document.getElementById('openAiBaseUrl').value = initConfig.baseUrl || '';
                        document.getElementById('openAiEndpoint').value = initConfig.endpointPath || '/chat/completions';
                        document.getElementById('openAiModel').value = initConfig.model || '';
                        document.getElementById('openAiAuthType').value = initConfig.authType || 'bearer';
                    } else if (initConfig.type === 'generic-http') {
                        document.getElementById('genericUrl').value = initConfig.url || '';
                        document.getElementById('genericMethod').value = initConfig.method || 'POST';
                        document.getElementById('genericHeaders').value = initConfig.headersTemplate ? JSON.stringify(initConfig.headersTemplate, null, 2) : '{\\n  "Content-Type": "application/json",\\n  "Authorization": "Bearer {{apiKey}}"\\n}';
                        document.getElementById('genericBody').value = initConfig.bodyTemplate || '{\\n  "prompt": "{{userPrompt}}",\\n  "model": "{{model}}"\\n}';
                        document.getElementById('genericResponsePath').value = initConfig.responseTextPath || '';
                        document.getElementById('genericModel').value = initConfig.model || '';
                    }

                    const typeSelect = document.getElementById('providerType');
                    const nativeFields = document.getElementById('native-fields');
                    const openaiFields = document.getElementById('openai-fields');
                    const genericFields = document.getElementById('generic-fields');
                    const statusMsg = document.getElementById('status-msg');
                    const testBtn = document.getElementById('test-btn');
                    const saveAnywayBtn = document.getElementById('save-anyway-btn');
                    let currentConfigToSave = null;
                    let currentApiKeyToSave = '';

                    function updateVisibility() {
                        nativeFields.classList.add('hidden');
                        openaiFields.classList.add('hidden');
                        genericFields.classList.add('hidden');
                        if (typeSelect.value === 'native') nativeFields.classList.remove('hidden');
                        if (typeSelect.value === 'openai-compatible') openaiFields.classList.remove('hidden');
                        if (typeSelect.value === 'generic-http') genericFields.classList.remove('hidden');
                    }
                    typeSelect.addEventListener('change', updateVisibility);
                    updateVisibility();

                    window.applyPreset = function(preset) {
                        if (preset === 'groq') {
                            document.getElementById('openAiBaseUrl').value = 'https://api.groq.com/openai/v1';
                            document.getElementById('openAiEndpoint').value = '/chat/completions';
                            document.getElementById('openAiModel').value = 'llama3-70b-8192';
                            document.getElementById('openAiAuthType').value = 'bearer';
                            document.getElementById('displayName').value = 'Groq';
                        } else if (preset === 'openai') {
                            document.getElementById('openAiBaseUrl').value = 'https://api.openai.com/v1';
                            document.getElementById('openAiEndpoint').value = '/chat/completions';
                            document.getElementById('openAiModel').value = 'gpt-4o';
                            document.getElementById('openAiAuthType').value = 'bearer';
                            document.getElementById('displayName').value = 'OpenAI';
                        }
                    };

                    function buildConfig() {
                        const type = typeSelect.value;
                        const config = {
                            id: document.getElementById('providerId').value,
                            displayName: document.getElementById('displayName').value,
                            type: type
                        };

                        if (type === 'native') {
                            config.adapterId = document.getElementById('nativeAdapterId').value;
                            config.model = document.getElementById('nativeModel').value;
                        } else if (type === 'openai-compatible') {
                            config.baseUrl = document.getElementById('openAiBaseUrl').value;
                            config.endpointPath = document.getElementById('openAiEndpoint').value;
                            config.model = document.getElementById('openAiModel').value;
                            config.authType = document.getElementById('openAiAuthType').value;
                        } else if (type === 'generic-http') {
                            config.url = document.getElementById('genericUrl').value;
                            config.method = document.getElementById('genericMethod').value;
                            try {
                                config.headersTemplate = JSON.parse(document.getElementById('genericHeaders').value);
                            } catch(e) {
                                alert("Invalid JSON in headers");
                                return null;
                            }
                            config.bodyTemplate = document.getElementById('genericBody').value;
                            config.responseTextPath = document.getElementById('genericResponsePath').value;
                            config.model = document.getElementById('genericModel').value;
                        }
                        return config;
                    }

                    testBtn.addEventListener('click', () => {
                        const config = buildConfig();
                        if (!config) return;
                        
                        const apiKey = document.getElementById('apiKey').value;
                        
                        currentConfigToSave = config;
                        currentApiKeyToSave = apiKey;
                        
                        statusMsg.style.display = 'block';
                        statusMsg.className = '';
                        statusMsg.innerText = 'Testing API health... Please wait.';
                        saveAnywayBtn.classList.add('hidden');
                        testBtn.disabled = true;

                        vscode.postMessage({ command: 'testAndSave', config, apiKey });
                    });

                    saveAnywayBtn.addEventListener('click', () => {
                        if (!currentConfigToSave) return;
                        if (!confirm("Are you sure you want to save a broken configuration? This may prevent the extension from working properly.")) return;
                        vscode.postMessage({ command: 'saveAnyway', config: currentConfigToSave, apiKey: currentApiKeyToSave });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'saveSuccess':
                                statusMsg.className = 'status-working';
                                statusMsg.innerText = 'Health check passed and configuration saved!';
                                testBtn.disabled = false;
                                saveAnywayBtn.classList.add('hidden');
                                break;
                            case 'testFailed':
                                statusMsg.className = 'status-error';
                                statusMsg.innerText = 'Health check failed: ' + message.result.message + '\\n(Status: ' + message.result.status + ')';
                                testBtn.disabled = false;
                                saveAnywayBtn.classList.remove('hidden');
                                break;
                            case 'testing':
                                // Handled via pre-click
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}
