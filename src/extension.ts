import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Ably from 'ably';
import { execSync } from 'child_process';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("HappyCoding");
    outputChannel.appendLine('=== HappyCoding Extension Activating ===');
    
    try {
        outputChannel.appendLine('Step 1: Creating Webview Provider...');
        // 1. 初始化 Webview Provider
        const provider = new HappyCodingViewProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(HappyCodingViewProvider.viewType, provider)
        );
        outputChannel.appendLine('✓ Webview Provider registered');

        // 2. 超強效自動初始化
        const checkWorkspace = () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                outputChannel.appendLine(`Detected workspace: ${workspaceRoot}`);
                initProject(workspaceRoot);
                provider.updateWorkspace(workspaceRoot);
                return true;
            }
            return false;
        };

        let attempts = 0;
        const timer = setInterval(() => {
            if (checkWorkspace() || ++attempts > 5) clearInterval(timer);
        }, 1000);

        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(checkWorkspace));
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(checkWorkspace));

        // 3. 註冊發送訊息指令
        let sendMessageDisposable = vscode.commands.registerCommand('happycoding.sendMessage', async (target: string, content: string) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const config = readConfig(workspaceRoot);
            if (config && config.ably_apiKey) {
                provider.postMessageToAbly(target, content, config);
            }
        });
        outputChannel.appendLine('✓ Send message command registered');

        // 4. 重啟 vscode.lm.registerTool - 這是 Copilot 能「看見」並「使用」這個 Tool 的唯一方式！
        // 如果只在 package.json 宣告但沒有在程式碼裡 registerTool，Copilot 會直接無視它。
        outputChannel.appendLine('Step 2: Registering Language Model Tool (Required for Copilot)...');
        
        let toolExecuteDisposable = vscode.lm.registerTool('happycoding_send_message', {
            async invoke(options: vscode.LanguageModelToolInvocationOptions<{ to: string, content: string }>, _token: vscode.CancellationToken) {
                const args = options.input;
                outputChannel.appendLine(`[Tool Invoke] Tool triggered by AI with args: ${JSON.stringify(args)}`);
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: No workspace open')]);
                }
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const config = readConfig(workspaceRoot);
                
                if (!config || !config.ably_apiKey || !config.repoId) {
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: HappyCoding not configured')]);
                }

                try {
                    let targetGitName = args.to;
                    if (args.to !== 'all') {
                        const targetMember = findTeamMember(config, args.to);
                        if (targetMember) {
                            targetGitName = targetMember.git_name;
                        } else {
                            // Log available team members
                            const teamList = getTeamList(config);
                            outputChannel.appendLine(`Available members: ${teamList}`);
                        }
                    }
                    await provider.postMessageToAbly(targetGitName, args.content, config);
                    outputChannel.appendLine(`✓ Message sent to ${args.to}`);
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Success: Sent message to ${args.to}. Content: ${args.content}`)]);
                } catch (error: any) {
                    outputChannel.appendLine(`✗ Error: ${error.message}`);
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${error.message}`)]);
                }
            },
            async prepareInvocation(_options: vscode.LanguageModelToolInvocationOptions<any>, _token: vscode.CancellationToken) {
                return undefined;
            }
        });
        context.subscriptions.push(toolExecuteDisposable);
        outputChannel.appendLine('✓ Tool "happycoding_send_message" registered programmatically');

        // 5. 終極殺招：註冊一個 Chat Participant (@happycoding)
        // 既然 Copilot 裝死不自動呼叫 Tool，我們直接給用戶一個 @ 標籤
        outputChannel.appendLine('Step 3: Registering Chat Participant @happycoding...');
        const chatParticipant = vscode.chat.createChatParticipant('happycoding-agent', async (request, _context, response, token) => {
            response.progress('正在準備為您發訊...');
            const prompt = request.prompt;
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                response.markdown('錯誤：沒有開啟的專案。');
                return;
            }
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const config = readConfig(workspaceRoot);
            
            if (!config || !config.ably_apiKey) {
                response.markdown('請先點擊設定完成 HappyCoding 金鑰綁定。');
                return;
            }

            // 請 LM 分析要傳給誰以及傳什麼
            response.progress('思考語氣和對象...');
            const messages = [
                vscode.LanguageModelChatMessage.User(`分析以下使用者的意圖。判斷他想發送給誰 (to) 以及內容是什麼 (content)。
團隊成員名單:\n${getTeamList(config)}\n\n
規則:\n1.若沒指定人就是 'all'\n2.若有人設請改寫。\n
回傳嚴格 JSON 格式: {"to": "git_name_or_all", "content": "the message to send"}
使用者輸入: "${prompt}"`)
            ];

            try {
                const chatModels = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
                if (chatModels && chatModels.length > 0) {
                    const chatResponse = await chatModels[0].sendRequest(messages, {}, token);
                    let responseText = '';
                    for await (const chunk of chatResponse.text) {
                        responseText += chunk;
                    }
                    // parse JSON
                    let parsed: any;
                    try {
                        const jsonStr = responseText.replace(/```json|```/g, '').trim();
                        parsed = JSON.parse(jsonStr);
                    } catch (e) {
                        response.markdown(`⚠️ 解析失敗，直接採用輸入內容廣播...\n\n`);
                        parsed = { to: 'all', content: prompt };
                    }

                    response.progress(`正在透過 Ably 傳送給 ${parsed.to}...`);
                    await provider.postMessageToAbly(parsed.to, parsed.content, config);
                    response.markdown(`✅ 成功發送給 **${parsed.to}**！\n\n> ${parsed.content}`);
                }
            } catch (e: any) {
                response.markdown(`❌ 發送失敗：${e.message}`);
            }
        });
        chatParticipant.iconPath = new vscode.ThemeIcon('comment-discussion');
        context.subscriptions.push(chatParticipant);
        outputChannel.appendLine('✓ Chat participant @happycoding registered');

    let setupDisposable = vscode.commands.registerCommand('happycoding.setup', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const root = workspaceFolders[0].uri.fsPath;
            initProject(root); // Ensure files exist
            HappyCodingSettingsPanel.createOrShow(context.extensionUri, root);
        } else {
            const result = await vscode.window.showOpenDialog({ canSelectFolders: true });
            if (result && result[0]) {
                initProject(result[0].fsPath);
                HappyCodingSettingsPanel.createOrShow(context.extensionUri, result[0].fsPath);
            }
        }
    });

    context.subscriptions.push(sendMessageDisposable, setupDisposable);
    
    outputChannel.appendLine('=== HappyCoding Extension Activated Successfully ===');
    outputChannel.appendLine(`Total registered disposables: ${context.subscriptions.length}`);
    } catch (error: any) {
        outputChannel.appendLine(`❌ ERROR during activation: ${error.message}`);
        outputChannel.appendLine(error.stack);
    }
}

class HappyCodingSettingsPanel {
    public static currentPanel: HappyCodingSettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, private readonly _workspaceRoot: string) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'save':
                    this._saveConfig(message.data);
                    return;
                case 'bindMcp':
                    this._bindMcp();
                    return;
                case 'previewTheme':
                    if (HappyCodingViewProvider.currentView) {
                        HappyCodingViewProvider.currentView.changeTheme(message.theme);
                    }
                    return;
            }
        }, null, this._disposables);
    }

    private _bindMcp() {
        try {
            const homeDir = require('os').homedir();

            let nodePath = '';
            
            try {
                // Find all installed node versions in nvm directory and pick the highest one >= 18
                const home = require('os').homedir();
                const nvmDir = path.join(home, '.nvm', 'versions', 'node');
                
                if (fs.existsSync(nvmDir)) {
                    const versions = fs.readdirSync(nvmDir)
                        .filter((v: string) => v.startsWith('v'))
                        .map((v: string) => {
                            const version = parseInt(v.slice(1).split('.')[0]);
                            return { version, dir: path.join(nvmDir, v, 'bin', 'node') };
                        })
                        .filter((v: any) => v.version >= 18)
                        .sort((a: any, b: any) => b.version - a.version); // Descending

                    if (versions.length > 0) {
                        nodePath = versions[0].dir;
                    }
                }

                // If no nvm, test system 'node'
                if (!nodePath) {
                    const systemNodeStr = require('child_process').execSync('which node', { encoding: 'utf8' }).trim();
                    const verStr = require('child_process').execSync(`"${systemNodeStr}" -v`, { encoding: 'utf8' }).trim();
                    const ver = parseInt(verStr.slice(1).split('.')[0]);
                    if (ver >= 18) {
                        nodePath = systemNodeStr;
                    }
                }

            } catch (err) {
                // Ignore parsing errors, we just won't have a nodePath
            }

            if (!nodePath) {
                throw new Error("Could not find a Node.js version >= 18 installed on this system. MCP requires modern Node.js. Please install it via NVM.");
            }

            const mcpScriptPath = path.join(this._extensionUri.fsPath, 'out', 'mcp.js');

            const mcpServerConfig = {
                command: nodePath,
                args: [mcpScriptPath],
                disabled: false
            };


            const configPaths = [
                path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'), // Antigravity
                path.join(homeDir, '.cursor', 'mcp.json'), // Cursor
                path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), // Cline
                path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json'), // Roo Code
                path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json') // VS Code Copilot MCP
            ];

            let boundCount = 0;

            for (const configPath of configPaths) {
                const dir = path.dirname(configPath);
                // For VS Code extensions (Cline/Roo), only write if their globalStorage folder exists (meaning they installed it)
                if (configPath.includes('globalStorage') && !fs.existsSync(dir)) {
                    continue; 
                }

                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                let mcpConfig: any = {};
                let targetKey = 'mcpServers';

                if (fs.existsSync(configPath)) {
                    try {
                        mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        // VS Code native MCP uses "servers" instead of "mcpServers"
                        if (mcpConfig.servers && !mcpConfig.mcpServers) {
                            targetKey = 'servers';
                        }
                    } catch(e) {}
                }
                
                if (!mcpConfig[targetKey]) {
                    mcpConfig[targetKey] = {};
                }

                mcpConfig[targetKey]['happycoding'] = mcpServerConfig;
                fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
                boundCount++;
            }

            vscode.window.showInformationMessage(`HappyCoding MCP Server successfully bound to ${boundCount} AI Agents!`);
        } catch (error: any) {
            vscode.window.showErrorMessage('Failed to bind MCP server: ' + error.message);
        }
    }

    public static createOrShow(extensionUri: vscode.Uri, workspaceRoot: string) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (HappyCodingSettingsPanel.currentPanel) {
            HappyCodingSettingsPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel('happycodingSettings', 'HappyCoding Settings', column || vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [extensionUri]
        });

        HappyCodingSettingsPanel.currentPanel = new HappyCodingSettingsPanel(panel, extensionUri, workspaceRoot);
    }

    private _saveConfig(data: any) {
        const configPath = path.join(this._workspaceRoot, '.happycoding', 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
        vscode.window.showInformationMessage('HappyCoding: Configuration saved successfully!');
        this.dispose();
    }

    public dispose() {
        HappyCodingSettingsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _update() {
        const config = readConfig(this._workspaceRoot);
        this._panel.webview.html = this._getHtmlForWebview(config);
    }

    public refresh() {
        this._update();
    }

    private _getHtmlForWebview(config: any): string {
        // 生成 team 列表的 HTML
        const teamRows = (config.team || []).map((m: any, idx: number) => `
                    <div class="team-row" data-index="${idx}">
                        <input type="text" class="team-git" value="${m.git_name || m.git_username || ''}" readonly style="opacity:0.7;">
                        <input type="text" class="team-nick" placeholder="Nick name" value="${m.nick_name || ''}">
                        <textarea class="team-prompt" placeholder="Special prompt (optional)">${m.special_prompt || ''}</textarea>
                        <button class="btn-del" onclick="deleteRow(this)" title="Remove Member">×</button>
                    </div>`).join('');

        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body { padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
                .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 20px; }
                .tab { padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.7; font-weight: 600; }
                .tab.active { border-bottom: 2px solid var(--vscode-button-background); opacity: 1; color: var(--vscode-button-background); }
                .content { display: none; }
                .content.active { display: block; }
                .field { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-size: 12px; opacity: 0.8; }
                input, textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px; border-radius: 4px; }
                .team-row { display: grid; grid-template-columns: 1fr 1fr 2fr 40px; gap: 10px; margin-bottom: 10px; align-items: end; }
                .btn-save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 20px; cursor: pointer; border-radius: 4px; margin-top: 20px; }
                .btn-save:hover { background: var(--vscode-button-hoverBackground); }
                .btn-del { background: none; border: none; cursor: pointer; font-size: 16px; opacity: 0.5; color: var(--vscode-errorForeground); padding: 5px; margin: 0; }
                .btn-del:hover { opacity: 1; }
                h2 { font-weight: 300; margin-top: 0; }
                p.info { opacity: 0.6; font-size: 12px; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h2>HappyCoding Setup</h2>
            <div class="tabs">
                <div class="tab active" data-target="general">General Settings</div>
                <div class="tab" data-target="team">Team Aliases</div>
            </div>

            <div id="general" class="content active">
                <div class="field"><label>Git Username (Detected)</label><input type="text" id="git_username" value="${config.git_username || ''}"></div>
                <div class="field"><label>Repo ID / Channel</label><input type="text" id="repoId" value="${config.repoId || ''}"></div>
                <div class="field"><label>Ably API Key</label><input type="password" id="ably_apiKey" value="${config.ably_apiKey || ''}"></div>
                <div class="field"><label>Message Encryption Key (Optional)</label><input type="password" id="message_key" value="${config.message_key || ''}"></div>
                <div class="field"><label>System Prompt (Agent Vibe)</label><textarea id="system_prompt" rows="3">${config.system_prompt || ''}</textarea></div>
                <div class="field">
                    <label>Code Theme</label>
                    <select id="code_theme">
                        <option value="atom-one-dark" ${config.code_theme === 'atom-one-dark' || !config.code_theme ? 'selected' : ''}>Atom One Dark (Default)</option>
                        <option value="github-dark" ${config.code_theme === 'github-dark' ? 'selected' : ''}>GitHub Dark</option>
                        <option value="monokai" ${config.code_theme === 'monokai' ? 'selected' : ''}>Monokai</option>
                        <option value="dracula" ${config.code_theme === 'dracula' ? 'selected' : ''}>Dracula</option>
                        <option value="vs2015" ${config.code_theme === 'vs2015' ? 'selected' : ''}>VS 2015</option>
                        <option value="github" ${config.code_theme === 'github' ? 'selected' : ''}>GitHub Light</option>
                    </select>
                </div>
            </div>

            <div id="team" class="content">
                <p class="info">Configure team members' display names and communication styles. When sending messages to them, AI will apply their special prompts automatically.</p>
                <div id="team-list">
                    <div class="team-row" style="font-weight:bold; opacity:0.6; font-size:11px;">
                        <div>Git Username</div><div>Nick Name</div><div>Special Prompt</div><div></div>
                    </div>
                    ${teamRows || '<p class="info">No team members yet. They will appear here when they join the channel.</p>'}
                </div>
            </div>

            <button class="btn-save" onclick="save()">Save Configuration</button>
            <button class="btn-save" style="background:#5c2d91; margin-left:10px;" onclick="bindMcp()">Bind to AI Agent (MCP)</button>

            <script>
                const vscode = acquireVsCodeApi();
                
                document.querySelectorAll('.tab').forEach(t => {
                    t.addEventListener('click', () => {
                        document.querySelectorAll('.tab, .content').forEach(el => el.classList.remove('active'));
                        t.classList.add('active');
                        document.getElementById(t.dataset.target).classList.add('active');
                    });
                });

                function deleteRow(btn) {
                    btn.closest('.team-row').remove();
                }

                function bindMcp() {
                    vscode.postMessage({ command: 'bindMcp' });
                }

                function save() {
                    const data = {
                        git_username: document.getElementById('git_username').value,
                        repoId: document.getElementById('repoId').value,
                        ably_apiKey: document.getElementById('ably_apiKey').value,
                        message_key: document.getElementById('message_key').value,
                        system_prompt: document.getElementById('system_prompt').value,
                        code_theme: document.getElementById('code_theme').value,
                        team: []
                    };

                    const rows = document.querySelectorAll('.team-row[data-index]');
                    rows.forEach(row => {
                        const git = row.querySelector('.team-git').value;
                        const nick = row.querySelector('.team-nick').value;
                        const prompt = row.querySelector('.team-prompt').value;
                        if (git) data.team.push({ git_name: git, nick_name: nick || undefined, special_prompt: prompt || undefined });
                    });

                    vscode.postMessage({ command: 'save', data });
                }
                
                document.getElementById('code_theme').addEventListener('change', (e) => {
                    vscode.postMessage({ command: 'previewTheme', theme: e.target.value });
                });
            </script>
        </body>
        </html>`;
    }
}

class HappyCodingViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'happycoding.chatView';
    public static currentView?: HappyCodingViewProvider;
    private _view?: vscode.WebviewView;
    private _realtime?: Ably.Realtime;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public changeTheme(theme: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'changeTheme', theme });
        }
    }

    public updateWorkspace(_root: string) {
        this._updateHtml();
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
        HappyCodingViewProvider.currentView = this;
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'openSettings':
                    vscode.commands.executeCommand('happycoding.setup');
                    break;
                case 'connect':
                    this.connectToAbly();
                    break;
                case 'disconnect':
                    this.disconnectFromAbly();
                    break;
            }
        });
        this._updateHtml();
    }

    private _updateHtml() {
        if (!this._view) return;
        const isConnected = !!this._realtime && this._realtime.connection.state === 'connected';
        
        // Read theme config
        let codeTheme = 'atom-one-dark';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const config = readConfig(workspaceFolders[0].uri.fsPath);
            if (config && config.code_theme) {
                codeTheme = config.code_theme;
            }
        }
        
        this._view.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <link id="theme-link" rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${codeTheme}.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
                <style>
                    body { display: flex; height: 100vh; margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); overflow: hidden; }
                    #chat { flex: 3; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-panel-border); }
                    #presence { flex: 1; min-width: 120px; padding: 10px; background: var(--vscode-editor-background); overflow-y: auto; }
                    #messages { flex: 1; overflow-y: auto; padding: 10px; font-size: 13px; }
                    .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 10px; padding-bottom: 5px; }
                    h3 { font-size: 11px; text-transform: uppercase; margin: 0; color: var(--vscode-descriptionForeground); }
                    .btn-group { display: flex; gap: 5px; }
                    .btn { 
                        background: none; border: none; cursor: pointer; padding: 2px; color: var(--vscode-descriptionForeground); 
                        display: flex; align-items: center; justify-content: center; font-size: 14px;
                    }
                    .btn:hover:not(:disabled) { color: var(--vscode-foreground); }
                    .btn.active { color: #f1c40f; }
                    .msg { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; }
                    .avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
                    .msg-content { flex: 1; padding: 8px 10px; border-radius: 6px; background: var(--vscode-textBlockQuote-background); overflow-x: auto; }
                    .msg.me .msg-content { opacity: 0.85; }
                    .user { font-weight: bold; margin-right: 5px; }
                    .user.me { color: var(--vscode-textLink-foreground, #3498db); }
                    .user.other { color: #e83e8c; }
                    pre { position: relative; background: var(--vscode-editor-background); padding: 5px; border-radius: 4px; overflow-x: auto; border: 1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family); font-size: 12px; margin-top: 5px; }
                    .copy-btn { position: absolute; top: 10px; right: 10px; z-index: 10; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 2px 6px; font-size: 10px; cursor: pointer; border-radius: 3px; opacity: 0.6; transition: opacity 0.2s; }
                    .copy-btn:hover { opacity: 1; }
                    .online-user { color: #4ec9b0; font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; }
                    .online-user::before { content: "●"; color: #4ec9b0; margin-right: 6px; font-size: 8px; }
                    .status-tag { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: #333; margin-left: 5px; opacity: 0.8; }
                </style>
            </head>
            <body>
                <div id="chat">
                    <div class="header-container"><h3>Messages</h3></div>
                    <div id="messages"></div>
                </div>
                <div id="presence">
                    <div class="header-container">
                        <h3>Online Status</h3>
                        <div class="btn-group">
                            ${isConnected 
                                ? '<button class="btn active" id="disconnect-btn" title="Disconnect">🔌</button>'
                                : '<button class="btn" id="connect-btn" title="Connect to Ably">⚡</button>'
                            }
                            <button class="btn" id="settings-trigger" title="Settings">⚙️</button>
                        </div>
                    </div>
                    <div id="users">
                        <div style="opacity:0.5; font-size:11px;">Disconnected</div>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    document.getElementById('settings-trigger').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
                    const connBtn = document.getElementById('connect-btn');
                    if(connBtn) connBtn.addEventListener('click', () => vscode.postMessage({ type: 'connect' }));
                    const disBtn = document.getElementById('disconnect-btn');
                    if(disBtn) disBtn.addEventListener('click', () => vscode.postMessage({ type: 'disconnect' }));
                    
                    window.addEventListener('message', event => {
                        const data = event.data;
                        if (data.type === 'newMsg') {
                            const messages = document.getElementById('messages');
                            const div = document.createElement('div');
                            div.className = data.isMe ? 'msg me' : 'msg';
                            
                            if (data.isSystem) {
                                div.innerHTML = '<span style="color: #e67e22;">' + data.from + ' : ' + data.text + '</span>';
                            } else {
                                const userClass = data.isMe ? 'user me' : 'user other';
                                let textContent = data.text;
                                
                                if (data.to === 'all') {
                                    textContent = '📢 <span style="color: #f1c40f;">' + data.text + '</span>';
                                }
                                
                                const avatarSrc = 'https://github.com/' + data.gitUser + '.png';
                                const fallbackAvatar = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + data.from;
                                
                                let html = '<img src="' + avatarSrc + '" class="avatar" onerror="this.onerror=null; this.src=\\'' + fallbackAvatar + '\\';" />';
                                html += '<div class="msg-content">';
                                html += '<div style="margin-bottom: 4px;"><span class="' + userClass + '">' + data.from + '</span></div>';
                                html += '<div style="word-wrap: break-word;">' + textContent + '</div>';
                                
                                if (data.code) {
                                    const encodedCode = data.code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                    html += '<div style="position:relative; margin-top: 8px;"><button class="copy-btn" onclick="copyCode(this)">Copy</button><pre><code>' + encodedCode + '</code></pre></div>';
                                }
                                html += '</div>';
                                div.innerHTML = html;
                            }
                            messages.appendChild(div);
                            
                            // Highlight the newly added code blocks
                            div.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                                hljs.highlightElement(block);
                            });
                            
                            messages.scrollTop = messages.scrollHeight;
                        } else if (data.type === 'presenceUpdate') {
                            const usersDiv = document.getElementById('users');
                            usersDiv.innerHTML = data.members.map(m => '<div class="online-user">' + m.nick + ' <span class="status-tag">' + m.git + '</span></div>').join('');
                        } else if (data.type === 'clearPresence') {
                            document.getElementById('users').innerHTML = '<div style="opacity:0.5; font-size:11px;">Disconnected</div>';
                        } else if (data.type === 'changeTheme') {
                            const link = document.getElementById('theme-link');
                            if (link) {
                                link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/' + data.theme + '.min.css';
                            }
                        }
                    });

                    function copyCode(btn) {
                        const codeBlock = btn.nextElementSibling.querySelector('code');
                        if (codeBlock) {
                            navigator.clipboard.writeText(codeBlock.textContent).then(() => {
                                const originalText = btn.textContent;
                                btn.textContent = 'Copied!';
                                setTimeout(() => btn.textContent = originalText, 2000);
                            }).catch(err => {
                                console.error('Failed to copy: ', err);
                            });
                        }
                    }
                </script>
            </body>
            </html>`;
    }

    public disconnectFromAbly() {
        if (this._realtime) {
            this._realtime.close();
            this._realtime = undefined;
            outputChannel.appendLine('Ably connection closed manually.');
        }
        this._updateHtml();
        this._view?.webview.postMessage({ type: 'clearPresence' });
        
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const statePath = path.join(workspaceFolders[0].uri.fsPath, '.happycoding', '.connected');
                if (fs.existsSync(statePath)) {
                    fs.unlinkSync(statePath);
                }
            }
        } catch (e) {
            // ignore
        }
    }

    public async connectToAbly() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const root = workspaceFolders[0].uri.fsPath;
        const config = readConfig(root);

        if (!config.git_username || !config.repoId || !config.ably_apiKey) {
            vscode.window.showErrorMessage('HappyCoding: Missing required settings! Check settings.');
            return;
        }

        try {
            if (this._realtime) this._realtime.close();
            this._realtime = new Ably.Realtime({ key: config.ably_apiKey, clientId: config.git_username });

            this._realtime.connection.on('connected', () => {
                outputChannel.appendLine(`SUCCESS: Connected to ${config.repoId}`);
                
                try {
                    const happyDir = path.join(root, '.happycoding');
                    if (!fs.existsSync(happyDir)) fs.mkdirSync(happyDir, { recursive: true });
                    fs.writeFileSync(path.join(happyDir, '.connected'), 'true');
                } catch(e) {}
                
                this._updateHtml(); // Toggle button to 🔌
                this._subscribeToEvents(config, root);
            });

            this._realtime.connection.on('failed', (sc) => {
                outputChannel.appendLine(`Ably Error: ${sc.reason?.message}`);
                this.disconnectFromAbly();
            });
        } catch (e) { outputChannel.appendLine(`Ably Error: ${e}`); }
    }

    private _subscribeToEvents(config: any, root: string) {
        if (!this._realtime) return;
        const channel = this._realtime.channels.get(config.repoId);

        // --- Presence (Online / Offline) ---
        channel.presence.enter();
        const updateUI = async () => {
            const members = await channel.presence.get();
            let currentConfig = readConfig(root);
            let teamChanged = false;

            const mappedMembers = members.map(m => {
                let teamMember = (currentConfig.team || []).find((t: any) => t.git_name === m.clientId || t.git_username === m.clientId);
                if (!teamMember) {
                    teamMember = { git_name: m.clientId, nick_name: '', special_prompt: '' };
                    currentConfig.team = currentConfig.team || [];
                    currentConfig.team.push(teamMember);
                    teamChanged = true;
                }
                return { git: m.clientId, nick: teamMember?.nick_name || m.clientId };
            });

            if (teamChanged) {
                fs.writeFileSync(path.join(root, '.happycoding', 'config.json'), JSON.stringify(currentConfig, null, 2));
                if (HappyCodingSettingsPanel.currentPanel) HappyCodingSettingsPanel.currentPanel.refresh();
            }

            this._view?.webview.postMessage({ type: 'presenceUpdate', members: mappedMembers });
        };

        channel.presence.subscribe(['enter', 'leave', 'present', 'update'], updateUI);
        updateUI();

        // --- Message Processing Helper ---
        const processMessage = (message: any) => {
            const data = message.data;
            if (!data || !data.from || !data.to || !data.content) return;

            // Optional Check: Only show if it's meant for 'all' or specifically for me (git_username)
            if (data.to === 'all' || data.to === config.git_username || data.from === config.git_username) {
                // Find nickname if available
                let currentConfig = readConfig(root);
                const senderConfig = (currentConfig.team || []).find((t: any) => t.git_name === data.from || t.git_username === data.from);
                const senderName = senderConfig?.nick_name || data.from;
                
                let displayName = senderName;
                if (data.is_agent) {
                    displayName = `Agent ${displayName}`;
                }

                // If message is encrypted, we could decrypt here later.
                const content = data.content;

                this._view?.webview.postMessage({ 
                    type: 'newMsg', 
                    from: displayName, 
                    to: data.to,
                    text: content,
                    code: data.code,
                    gitUser: data.from,
                    isMe: data.from === config.git_username
                });
            }
        };

        // --- Fetch History (Offline messages) ---
        channel.history({ limit: 30, direction: 'backwards' }).then((resultPage: any) => {
            if (resultPage && resultPage.items && resultPage.items.length > 0) {
                // Ably returns history backwards (newest first). Reverse to show oldest first.
                const historyMessages = resultPage.items.slice().reverse();
                // Process history messages first
                historyMessages.forEach(processMessage);
                // Send a separator message after the history
                this._view?.webview.postMessage({ type: 'newMsg', from: 'System', text: '--- End of history messages ---', isSystem: true });
            }
        }).catch((err: any) => {
            outputChannel.appendLine(`Error fetching history: ${err.message}`);
        });

        // --- Message Receiving (Live) ---
        channel.subscribe('message', processMessage);
    }

    public async postMessageToAbly(target: string, content: string, config: any) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'newMsg', from: 'Me', to: target, text: content, gitUser: config.git_username, isMe: true });
        }
        if (!this._realtime) {
            outputChannel.appendLine('Ably not connected. Sending skip.');
            return;
        }
        try {
            const channel = this._realtime.channels.get(config.repoId);
            await channel.publish('message', { from: config.git_username, to: target, content });
        } catch (e) {
            outputChannel.appendLine(`Publish Error: ${e}`);
        }
    }
}


/**
 * 在 team 中查找成員，支援 git_name 或 nick_name 的模糊配對
 */
function findTeamMember(config: any, nameOrGitName: string): any {
    if (!config.team || config.team.length === 0) {
        return null;
    }
    const lower = nameOrGitName.toLowerCase();
    return config.team.find((m: any) => 
        m.git_name.toLowerCase() === lower || 
        (m.nick_name && m.nick_name.toLowerCase() === lower)
    );
}

/**
 * 格式化 team 列表供顯示給 AI
 */
function getTeamList(config: any): string {
    if (!config.team || config.team.length === 0) {
        return '(No team members configured)';
    }
    return config.team
        .map((m: any) => `- ${m.nick_name || m.git_name} (git: ${m.git_name})${m.special_prompt ? ` [Style: ${m.special_prompt}]` : ''}`)
        .join('\n');
}

function getGitInfo(root: string) {
    let username = 'guest';
    let repoName = path.basename(root);
    try {
        username = execSync('git config user.name', { cwd: root }).toString().trim();
        const remoteUrl = execSync('git config --get remote.origin.url', { cwd: root }).toString().trim();
        if (remoteUrl) {
            // 解析 remote url (e.g. https://github.com/user/repo.git -> user/repo)
            const match = remoteUrl.match(/[:/]([^/]+\/[^/.]+)(\.git)?$/);
            if (match) repoName = match[1];
        }
    } catch (e) {}
    return { username, repoName };
}

function initProject(root: string, force: boolean = false) {
    outputChannel.appendLine(`Initializing project at ${root}...`);
    const dotHappyDir = path.join(root, '.happycoding');
    if (!fs.existsSync(dotHappyDir)) fs.mkdirSync(dotHappyDir);

    const { username, repoName } = getGitInfo(root);
    const configPath = path.join(dotHappyDir, 'config.json');

    if (!fs.existsSync(configPath) || force) {
        const defaultConfig = {
            git_username: username,
            repoId: repoName,
            ably_apiKey: "",
            message_key: null,
            system_prompt: "有禮貌，說人話",
            team: []
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    }
    checkAndInjectCursorRules(root);
}


function checkAndInjectCursorRules(root: string) {
    const cursorRulesPath = path.join(root, '.cursorrules');
    const cliPath = path.join(root, 'out', 'cli.js');
    const ruleContent = `
# --- HappyCoding Intelligence ---
當用戶請你傳送訊息 (例如「告訴 Judy...」或「@Judy...」或「跟大家講...」) 時：
1. 你 **絕對不可** 敷衍了事說「好我發了」卻無實際行動，必須使用 \`run_command\` 工具在終端機執行發送腳本。
2. 執行指令：\`node ${cliPath} --to "<收件人>" --content "<訊息>"\`
3. 收件人 \`<收件人>\`:
   - 若為廣播，填寫 "all"。
   - 若為私訊，填寫該隊友的 \`git_username\` (請至 \`.happycoding/config.json\` 內查找對應之 \`git_username\`)。
4. 訊息 \`<訊息>\`:
   - 若為私訊且在 \`config.json\` 中設有 \`special_prompt\` 人設，請依該人設 "**改寫**" 訊息內容，並在開頭加上 \`[你的名字] Agent: \`。
   - 若使用 \`@\` 開頭，代表用戶直發，不可改寫內容，請將 \`<訊息>\` 直接設定為用戶原句。
     (例如: \`@Judy: 嗨\` -> \`node ${cliPath} --to "Judy" --content "嗨"\`)
5. 回覆用戶時，你必須明確表示你已經透過 \`node ${cliPath}\` 執行了發送。
# --- End ---`;
    
    // Auto-overwrite if it doesn't contain the updated rules
    if (fs.existsSync(cursorRulesPath)) {
        const content = fs.readFileSync(cursorRulesPath, 'utf8');
        if (!content.includes('HappyCoding Intelligence')) {
            fs.appendFileSync(cursorRulesPath, '\\n' + ruleContent);
            outputChannel.appendLine('.cursorrules appended.');
        } else if (!content.includes('node ')) {
            // Force update old rules
            const updated = content.replace(/# --- HappyCoding Intelligence ---[\\s\\S]*?# --- End ---/, ruleContent.trim());
            fs.writeFileSync(cursorRulesPath, updated);
            outputChannel.appendLine('.cursorrules updated.');
        }
    } else {
        fs.writeFileSync(cursorRulesPath, ruleContent.trim());
        outputChannel.appendLine('.cursorrules created.');
    }
}

function readConfig(root: string): any {
    const configPath = path.join(root, '.happycoding', 'config.json');
    return fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
}

export function deactivate() {}
