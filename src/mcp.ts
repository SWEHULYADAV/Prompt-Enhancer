import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { runPipeline } from './promptPipeline';
import { WorkspaceIndexer } from './workspace';

export class McpServer {
    private server: http.Server | null = null;
    private authToken: string | null = null;

    public start(context: vscode.ExtensionContext) {
        if (this.server) {return;}

        const config = vscode.workspace.getConfiguration('contextforge.mcp');
        const port = config.get<number>('port') || 3000;
        
        // Generate a fresh session token if not already present
        this.authToken = crypto.randomBytes(16).toString('hex');

        this.server = http.createServer((req, res) => {
            // Check auth header
            const authHeader = req.headers['authorization'];
            if (authHeader !== `Bearer ${this.authToken}`) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Unauthorized. Missing or invalid MCP token." }));
                return;
            }

            const { method, url } = req;

            if (method === 'GET' && url === '/mcp/tools/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    tools: [
                        { name: "refine_prompt", description: "Refines a user prompt using workspace context and web search.", parameters: { prompt: "string" } },
                        { name: "get_current_context", description: "Returns a summary of the current workspace and git activity.", parameters: {} },
                        { name: "get_project_rules", description: "Returns project-specific rules from .contextforge/rules.md.", parameters: {} }
                    ]
                }));
                return;
            }

            if (method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const json = body ? JSON.parse(body) : {};
                        const indexer = new WorkspaceIndexer();

                        switch (url) {
                            case '/mcp/tools/refine_prompt':
                                if (!json.prompt) { throw new Error("Missing prompt argument"); }
                                const refined = await runPipeline(json.prompt, context);
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ result: refined }));
                                break;

                            case '/mcp/tools/get_current_context':
                                const summary = await indexer.summarizeWorkspace();
                                const git = indexer.getRecentGitContext();
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ context: summary, git: git }));
                                break;

                            case '/mcp/tools/get_project_rules':
                                const rules = indexer.getProjectRules();
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ rules: rules || "No rules defined." }));
                                break;

                            default:
                                res.writeHead(404);
                                res.end();
                        }
                    } catch (err: any) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        this.server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                vscode.window.showErrorMessage(`ContextForge MCP Error: Port ${port} is already in use.`);
            } else {
                vscode.window.showErrorMessage(`ContextForge MCP Error: ${err.message}`);
            }
            this.stop();
        });

        this.server.listen(port, async () => {
            await vscode.env.clipboard.writeText(this.authToken!);
            vscode.window.showInformationMessage(`ContextForge MCP Server started on port ${port}. Auth Token copied to clipboard.`);
        });
    }

    public getAuthToken(): string | null {
        return this.authToken;
    }

    public stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.authToken = null;
            vscode.window.showInformationMessage('ContextForge MCP Server stopped.');
        }
    }
}
