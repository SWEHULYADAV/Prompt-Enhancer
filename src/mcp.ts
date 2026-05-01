import * as vscode from 'vscode';
import * as http from 'http';
import { runPipeline } from './promptPipeline';

export class McpServer {
    private server: http.Server | null = null;
    private port = 3000;

    public start(context: vscode.ExtensionContext) {
        if (this.server) {return;}

        // NOTE: Standard MCP protocol primarily uses `stdio` or Server-Sent Events (SSE) 
        // to communicate. This is a simplified raw HTTP mock for the MVP to illustrate
        // the capability without requiring the full `@modelcontextprotocol/sdk`.
        // In a production scenario, this should be a standard MCP Express/SSE server
        // or a child process launcher bridging stdio.
        this.server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === '/mcp/tools/refine_prompt') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const json = JSON.parse(body);
                        const initialPrompt = json.prompt;
                        
                        if (!initialPrompt) {throw new Error("Missing prompt argument");}

                        const refined = await runPipeline(initialPrompt, context);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ result: refined }));
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

        this.server.listen(this.port, () => {
            vscode.window.showInformationMessage(`ContextForge MCP Server started on port ${this.port}`);
        });
    }

    public stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
            vscode.window.showInformationMessage('ContextForge MCP Server stopped.');
        }
    }
}
