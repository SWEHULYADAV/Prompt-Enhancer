import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { SearchResult } from './types';

export class SearxngClient {
    private baseUrl: string;

    constructor() {
        this.baseUrl = vscode.workspace.getConfiguration('contextforge').get<string>('searxng.baseUrl') || 'http://localhost:8080';
        this.validateUrl();
    }

    private validateUrl() {
        try {
            const u = new URL(this.baseUrl);
            const host = u.hostname;
            // Prevent basic SSRF to AWS metadata or common private subnets (except localhost)
            if (host === '169.254.169.254' || host.startsWith('10.') || 
                host.startsWith('192.168.') || host.startsWith('172.16.') || 
                host.startsWith('172.31.')) {
                // We allow localhost/127.0.0.1 as SearXNG is often run locally
                throw new Error("Invalid SearXNG URL: Internal network addresses are not allowed for security reasons.");
            }
        } catch (e: any) {
            if (e.message.includes('Invalid SearXNG URL')) {
                throw e;
            }
        }
    }

    public async search(query: string, maxRetries = 2): Promise<SearchResult[]> {
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                return await this._searchInternal(query);
            } catch (err: any) {
                attempt++;
                if (attempt > maxRetries) {
                    throw err;
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
        return [];
    }

    private async _searchInternal(query: string): Promise<SearchResult[]> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(`${this.baseUrl}/search`);
            urlObj.searchParams.append('q', query);
            urlObj.searchParams.append('format', 'json');

            const isHttps = urlObj.protocol === 'https:';
            const requestModule = isHttps ? https : http;

            const req = requestModule.get(urlObj.toString(), (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const json = JSON.parse(data);
                            if (json.results && Array.isArray(json.results)) {
                                const mapped: SearchResult[] = json.results.map((r: any) => ({
                                    title: r.title || '',
                                    url: r.url || '',
                                    content: r.content || '',
                                    engine: r.engine || '',
                                    score: r.score,
                                    publishedDate: r.publishedDate
                                }));
                                resolve(this.deduplicate(mapped));
                            } else {
                                resolve([]);
                            }
                        } catch (e) {
                            reject(new Error('Invalid JSON response from SearXNG'));
                        }
                    } else {
                        reject(new Error(`SearXNG returned status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`Failed to connect to SearXNG at ${this.baseUrl}: ${e.message}`));
            });
            
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('SearXNG request timed out'));
            });
        });
    }

    private deduplicate(results: SearchResult[]): SearchResult[] {
        const seenUrls = new Set<string>();
        const deduplicated: SearchResult[] = [];
        for (const res of results) {
            let url = res.url;
            try {
                const u = new URL(res.url);
                url = u.origin + u.pathname;
            } catch (e) {}
            
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                deduplicated.push(res);
            }
        }
        return deduplicated;
    }

    public async checkHealth(): Promise<void> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(`${this.baseUrl}/search?q=test&format=json`);
            const isHttps = urlObj.protocol === 'https:';
            const requestModule = isHttps ? https : http;

            const req = requestModule.get(urlObj.toString(), (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 403 || res.statusCode === 400) {
                        reject(new Error("SearXNG JSON output is not enabled. Enable `json` in `search.formats` inside SearXNG `settings.yml`."));
                        return;
                    }
                    if (res.statusCode === 200) {
                        try {
                            JSON.parse(data);
                            resolve();
                        } catch (e) {
                            reject(new Error("SearXNG JSON output is not enabled. Enable `json` in `search.formats` inside SearXNG `settings.yml`."));
                        }
                    } else {
                        reject(new Error(`SearXNG returned status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`Failed to connect to SearXNG at ${this.baseUrl}: ${e.message}`));
            });
            
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error('SearXNG health check timed out.'));
            });
        });
    }
}
