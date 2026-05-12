import * as vscode from 'vscode';
import { runPipeline } from './promptPipeline';
import { redactSensitiveData } from './utils';

/**
 * registerChatParticipant — Strategy 2: "@contextforge Chat Agent"
 *
 * VS Code ke native chat panel mein @contextforge participant register karta hai.
 * User type kare: "@contextforge build me a login page"
 * ContextForge workspace scan + web search karke enhanced prompt stream karta hai.
 *
 * VS Code 1.90+ required for vscode.chat API.
 */
export function registerChatParticipant(context: vscode.ExtensionContext): vscode.Disposable {
    // Chat API older VS Code versions mein available nahi hota
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(vscode as any).chat) {
        // Silently skip — older VS Code versions pe crash na ho
        return { dispose: () => { /* noop */ } };
    }

    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        _chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        const userPrompt = request.prompt.trim();

        // ── Empty prompt ────────────────────────────────────────────────
        if (!userPrompt) {
            stream.markdown([
                '## ✨ ContextForge Prompt Enhancer',
                '',
                'Apna rough prompt type karo aur main use enhance kar deta hoon!',
                '',
                '**Example:**',
                '```',
                '@contextforge add a real-time notification system to my Next.js app',
                '```',
                '',
                'Main aapke workspace ko scan karunga, web search karunga, aur ek',
                'professional, context-aware prompt banaunga jo Claude/Cursor ke liye ready hoga.'
            ].join('\n'));
            return;
        }

        // ── Kaam shuru ─────────────────────────────────────────────────
        stream.markdown(`## ✨ Enhancing: *"${userPrompt}"*\n\n`);
        stream.markdown('---\n\n');

        // Cancel check
        if (token.isCancellationRequested) { return; }

        try {
            let tokenCount = 0;
            let hadStreamingTokens = false;

            const refined = await runPipeline(
                userPrompt,
                context,
                (progressEvent) => {
                    // Progress updates stream karo
                    if (progressEvent.status === 'running') {
                        stream.progress(progressEvent.label);
                    }
                    if (progressEvent.status === 'error' && progressEvent.message) {
                        stream.markdown(`\n> ⚠️ *${progressEvent.label}: ${progressEvent.message}*\n\n`);
                    }
                },
                (chunk) => {
                    // Real-time streaming — har token directly user ko dikhao
                    if (!hadStreamingTokens) {
                        hadStreamingTokens = true;
                        stream.markdown('### 📋 Enhanced Prompt\n\n');
                    }
                    stream.markdown(chunk);
                    tokenCount++;

                    // Cancel check during streaming
                    if (token.isCancellationRequested) { return; }
                }
            );

            // Agar streaming nahi hua (provider ne bulk response diya)
            if (!hadStreamingTokens && refined) {
                stream.markdown('### 📋 Enhanced Prompt\n\n');
                stream.markdown(refined);
            }

            // ── Final instructions ──────────────────────────────────────
            stream.markdown('\n\n---\n\n');
            stream.markdown([
                '**Ab kya karein?**',
                '1. Upar wala enhanced prompt copy karo',
                '2. Claude Code / Cursor / Antigravity mein paste karo',
                '3. Ya `ContextForge: Sync Agent Files` run karo — yeh automatically inject ho jayega',
            ].join('\n'));

            // Action buttons
            stream.button({
                command: 'contextforge.syncAgentFiles',
                title: '$(sync) Sync to Agent Files'
            });
            stream.button({
                command: 'contextforge.openPromptRefiner',
                title: '$(edit) Open in Full Panel'
            });

        } catch (err: any) {
            const safeMsg = redactSensitiveData(err.message || String(err));
            stream.markdown([
                '\n\n---\n\n',
                `❌ **Error:** ${safeMsg}`,
                '',
                '**Fix karo:**',
                '- `Ctrl+Shift+P` → `ContextForge: Configure Provider` → API key set karo',
                '- Ya `ContextForge: Configure SearXNG` run karo agar search issue hai'
            ].join('\n'));
        }
    };

    // Chat participant create karo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const participant = (vscode as any).chat.createChatParticipant('contextforge.enhance', handler);
    participant.iconPath = new vscode.ThemeIcon('sparkle');
    participant.followupProvider = {
        provideFollowups: (_result: unknown, _context: unknown, _token: vscode.CancellationToken) => {
            return [
                {
                    prompt: 'Sync this enhanced prompt to my agent files',
                    command: 'syncAgentFiles',
                    label: '$(sync) Sync to Agent Files'
                }
            ];
        }
    };

    return participant as vscode.Disposable;
}
