import * as fs from 'fs';
import * as path from 'path';
import * as Ably from 'ably';

async function run() {
    const args = process.argv.slice(2);
    let to = 'all';
    let content = '';

    // Robust arg parser
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if ((arg === '--to' || arg === '--send') && i + 1 < args.length) {
            to = args[i + 1];
            i++;
        } else if ((arg === '--content' || arg === '-m' || arg === '--message') && i + 1 < args.length) {
            content = args[i + 1];
            i++;
        } else if (arg === '-h' || arg === '--help') {
            console.log("用法: node cli.js --to <username_or_all> --content <message_text>");
            process.exit(0);
        } else {
            // Positional arguments fallback
            if (!content && i === 0 && args.length >= 2 && !args[0].startsWith('-')) {
                // assume first arg is 'to', rest is 'content'
                to = args[0];
                content = args.slice(1).join(' ');
                break;
            } else {
                content += (content ? ' ' : '') + arg;
            }
        }
    }

    content = content.trim();

    if (!content) {
        console.error("用法: node cli.js --to <username_or_all> --content <message_text>");
        process.exit(1);
    }

    const rootDir = process.cwd();
    const configPath = path.join(rootDir, '.happycoding', 'config.json');

    if (!fs.existsSync(configPath)) {
        console.error(`[Error] 找不到 .happycoding/config.json，請確認您已在 VS Code 中設定過 HappyCoding。`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (!config.git_username || !config.repoId || !config.ably_apiKey) {
        console.error(`[Error] config.json 缺少必要設定 (git_username, repoId, ably_apiKey)。`);
        process.exit(1);
    }

    console.log(`正在透過 Ably 發送訊息至 ${config.repoId} (收件人: ${to})...`);

    const realtime = new Ably.Realtime({ key: config.ably_apiKey, clientId: config.git_username });
    const channel = realtime.channels.get(config.repoId);

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            realtime.close();
            console.error(`[Error] 連線超時。`);
            reject(new Error("Timeout"));
        }, 10000);

        realtime.connection.once('connected', async () => {
            try {
                await channel.publish('message', { from: config.git_username, to: to, content: content });
                clearTimeout(timeout);
                realtime.close();
                console.log(`[Success] 訊息已成功發送給 ${to}！\n內容: ${content}`);
                resolve();
            } catch(e: any) {
                clearTimeout(timeout);
                realtime.close();
                console.error(`[Error] 訊息發送失敗: ${e.message}`);
                reject(e);
            }
        });
        
        realtime.connection.once('failed', (sc) => {
             clearTimeout(timeout);
             console.error(`[Error] Ably 連線失敗: ${sc.reason?.message || "Unknown error"}`);
             reject(new Error("Connection Failed"));
        });
    });
}

run().then(() => process.exit(0)).catch(() => process.exit(1));
