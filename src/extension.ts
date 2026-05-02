import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PromptRefinerPanel, ProviderConfigPanel, SidebarProvider } from './webview';
import { AgentInstructionSyncService } from './agentSync';
import { WorkspaceIndexer } from './workspace';
import { McpServer } from './mcp';
import { ProviderConfigManager } from './providerConfig';
import { runPipeline } from './promptPipeline';
import { mapErrorToUiError, redactSensitiveData } from './utils';
import { ContextStore } from './contextStore';

// ─── Shared one-click refine logic ───────────────────────────────────────────
async function runQuickRefine(
    prompt: string,
    context: vscode.ExtensionContext,
    onResult: (refined: string) => Promise<void>
) {
    if (!prompt.trim()) {
        vscode.window.showWarningMessage('ContextForge: No prompt text found.');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'ContextForge: Enhancing prompt...',
        cancellable: false
    }, async (progress) => {
        const steps = [
            'Checking Provider', 'Checking SearXNG', 'Scanning Workspace',
            'Planning Searches', 'Searching Web', 'Refining Prompt'
        ];
        let stepIdx = 0;

        try {
            const refined = await runPipeline(prompt, context, (event) => {
                if (event.status === 'running') {
                    progress.report({
                        message: steps[stepIdx] || event.label,
                        increment: Math.floor(100 / steps.length)
                    });
                    stepIdx++;
                }
            });

            await onResult(refined);
        } catch (err: any) {
            const uiError = mapErrorToUiError(err);
            const redacted = redactSensitiveData(uiError.message);
            const action = await vscode.window.showErrorMessage(
                `ContextForge: ${uiError.title} — ${redacted}`,
                uiError.actions?.[0]?.label || 'Open Refiner'
            );
            if (action) {
                PromptRefinerPanel.createOrShow(context, prompt);
            }
        }
    });
}

// ─── Extension activation ─────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
    // Register Sidebar
    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("contextforge.statusView", sidebarProvider)
    );

    const commands = [
        // ── Panel ────────────────────────────────────────────────────────────
        vscode.commands.registerCommand('contextforge.openPromptRefiner', () => {
            PromptRefinerPanel.createOrShow(context);
        }),

        // ── One-click: Selected Text ──────────────────────────────────────────
        vscode.commands.registerCommand('contextforge.refineSelectedText', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('ContextForge: Select some text first, then run this command.');
                return;
            }
            const selected = editor.document.getText(editor.selection);
            await runQuickRefine(selected, context, async (refined) => {
                await vscode.env.clipboard.writeText(refined);
                const action = await vscode.window.showInformationMessage(
                    'ContextForge: Enhanced prompt copied to clipboard!',
                    'Insert at Cursor', 'Open in Panel'
                );
                if (action === 'Insert at Cursor') {
                    await editor.edit(eb => eb.replace(editor.selection, refined));
                } else if (action === 'Open in Panel') {
                    PromptRefinerPanel.createOrShow(context, refined);
                }
            });
        }),

        // ── One-click: Clipboard ──────────────────────────────────────────────
        vscode.commands.registerCommand('contextforge.refineClipboard', async () => {
            const clipText = await vscode.env.clipboard.readText();
            if (!clipText.trim()) {
                vscode.window.showWarningMessage('ContextForge: Clipboard is empty. Copy a prompt first.');
                return;
            }
            await runQuickRefine(clipText, context, async (refined) => {
                await vscode.env.clipboard.writeText(refined);
                const action = await vscode.window.showInformationMessage(
                    'ContextForge: Enhanced prompt is now in your clipboard!',
                    'Open in Panel'
                );
                if (action === 'Open in Panel') {
                    PromptRefinerPanel.createOrShow(context, refined);
                }
            });
        }),

        // ── One-click: Insert at Cursor ───────────────────────────────────────
        vscode.commands.registerCommand('contextforge.insertEnhancedPrompt', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('ContextForge: No active editor. Open a file first.');
                return;
            }

            // Use selection if present, otherwise ask via input box
            let prompt = editor.selection.isEmpty
                ? undefined
                : editor.document.getText(editor.selection);

            if (!prompt) {
                prompt = await vscode.window.showInputBox({
                    prompt: 'Enter a rough prompt to enhance',
                    placeHolder: 'e.g. add login page to my Next.js app',
                    ignoreFocusOut: true
                });
            }
            if (!prompt) { return; }

            const capturedSelection = editor.selection;
            await runQuickRefine(prompt, context, async (refined) => {
                await editor.edit(eb => {
                    if (!editor.selection.isEmpty) {
                        eb.replace(capturedSelection, refined);
                    } else {
                        eb.insert(capturedSelection.active, refined);
                    }
                });
                vscode.window.showInformationMessage('ContextForge: Enhanced prompt inserted at cursor.');
            });
        }),

        // ── One-click: Save Last Enhanced Prompt ────────────────────────────
        vscode.commands.registerCommand('contextforge.saveLastPrompt', async () => {
            const store = new ContextStore();
            const last = store.getLastRefinedPrompt();
            if (!last) {
                vscode.window.showWarningMessage('ContextForge: No enhanced prompt found in this session. Refine a prompt first.');
                return;
            }
            const uri = await vscode.window.showSaveDialog({
                filters: { 'Markdown': ['md'], 'Text': ['txt'] },
                saveLabel: 'Save Enhanced Prompt',
                defaultUri: vscode.Uri.file('enhanced-prompt.md')
            });
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(last, 'utf8'));
                vscode.window.showInformationMessage(`ContextForge: Saved to ${uri.fsPath}`);
            }
        }),

        // ── Provider Config ───────────────────────────────────────────────────
        vscode.commands.registerCommand('contextforge.configureSearxng', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'contextforge.searxng.baseUrl');
        }),

        vscode.commands.registerCommand('contextforge.editProjectRules', async () => {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace open.');
                return;
            }
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const dir = path.join(root, '.contextforge');
            const rulesPath = path.join(dir, 'rules.md');

            if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
            if (!fs.existsSync(rulesPath)) {
                fs.writeFileSync(rulesPath, '# Project Rules\n\n- Always use TypeScript.\n- Keep components functional.\n- Follow standard naming conventions.');
            }
            
            const doc = await vscode.workspace.openTextDocument(rulesPath);
            await vscode.window.showTextDocument(doc);
        }),

        vscode.commands.registerCommand('contextforge.configureProvider', () => {
            ProviderConfigPanel.createOrShow(context);
        }),
        vscode.commands.registerCommand('contextforge.exportProviderConfig', async () => {
            try {
                const configStr = await ProviderConfigManager.exportConfig();
                const doc = await vscode.workspace.openTextDocument({ content: configStr, language: 'json' });
                vscode.window.showTextDocument(doc);
            } catch (e: any) {
                vscode.window.showErrorMessage("Failed to export: " + e.message);
            }
        }),
        vscode.commands.registerCommand('contextforge.importProviderConfig', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Paste the exported JSON configuration',
                placeHolder: '{ "schemaVersion": 1, ... }'
            });
            if (input) {
                try {
                    await ProviderConfigManager.importConfig(input);
                    vscode.window.showInformationMessage("Provider config imported successfully.");
                    if (ProviderConfigPanel.currentPanel) {
                        ProviderConfigPanel.currentPanel.refresh();
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage(e.message);
                }
            }
        }),

        // ── Agent Sync ────────────────────────────────────────────────────────
        vscode.commands.registerCommand('contextforge.syncAgentFiles', async () => {
            const indexer = new WorkspaceIndexer();
            const summary = await indexer.summarizeWorkspace();
            const syncService = new AgentInstructionSyncService();
            await syncService.sync("No active task refined yet. Use ContextForge to refine a prompt.", summary);
        }),
        vscode.commands.registerCommand('contextforge.rollbackSync', () => {
            const syncService = new AgentInstructionSyncService();
            const restored = syncService.rollback();
            if (restored.length > 0) {
                vscode.window.showInformationMessage(`Successfully rolled back ${restored.length} agent instruction files.`);
            } else {
                vscode.window.showInformationMessage('No backup files found to rollback.');
            }
        }),

        // ── MCP (placeholder, not implemented yet) ────────────────────────────
        vscode.commands.registerCommand('contextforge.startMcpServer', () => {
            if (!mcpServerInstance) {
                const server = new McpServer();
                server.start(context);
                mcpServerInstance = server;
            } else {
                vscode.window.showInformationMessage('MCP Server already running.');
            }
        }),
        vscode.commands.registerCommand('contextforge.stopMcpServer', () => {
            if (mcpServerInstance) {
                mcpServerInstance.stop();
                mcpServerInstance = undefined;
            }
        })
    ];

    context.subscriptions.push(...commands);

    // Register keyboard shortcuts context key
    vscode.commands.executeCommand('setContext', 'contextforge.active', true);
}

let mcpServerInstance: McpServer | undefined;

// Override the MCP commands in activate or add them here
export function deactivate() {
    if (mcpServerInstance) {
        mcpServerInstance.stop();
        mcpServerInstance = undefined;
    }
}
