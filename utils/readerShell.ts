// Frees the Impinj R700 when another device or app holds its only LLRP
// connection. The reader accepts one LLRP client at a time and refuses
// newcomers (ConnectionAttemptEvent
// Failed_A_Client_Initiated_Connection_Already_Exists); besides that client
// itself, only the reader's admin shell (RShell, over SSH) can drop it:
// `config rfid llrp connclose`. RShell answers with Status='<code>,<text>':
// 0 = closed, 8 (Permission-Denied) = there was none.
// Same as the desktop app's readerShell.js; keep the two in step.
const { Client } = require('ssh2');

const SHELL_TIMEOUT_MS = 12000;

export function closeLlrpConnection({ host, username, password }: { host: string; username: string; password: string }): Promise<{ closed: boolean; status: string }> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let output = '';
        let sent = false;
        let settled = false;
        const finish = (err: Error | null, value?: { closed: boolean; status: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { conn.end(); } catch (e) { /* already closed */ }
            if (err) reject(err); else resolve(value!);
        };
        const timer = setTimeout(() => finish(new Error(`The reader's admin shell at ${host} did not answer in time.`)), SHELL_TIMEOUT_MS);

        conn
            .on('ready', () => {
                conn.shell({ term: 'dumb' }, (err: any, stream: any) => {
                    if (err) return finish(err);
                    stream.on('data', (chunk: Buffer) => {
                        output += chunk.toString('utf8');
                        // Send the command once RShell shows its prompt.
                        if (!sent && />\s*$/.test(output)) {
                            sent = true;
                            output = '';
                            stream.write('config rfid llrp connclose\r\n');
                            return;
                        }
                        const m = sent && output.match(/Status='(\d+),([^']*)'/);
                        if (m) {
                            stream.write('exit\r\n');
                            const code = Number(m[1]);
                            if (code === 0 || code === 8) finish(null, { closed: code === 0, status: `${m[1]},${m[2]}` });
                            else finish(new Error(`The reader refused to close its LLRP connection (Status ${m[1]}, ${m[2]}).`));
                        }
                    });
                    stream.on('close', () => finish(new Error("The reader's admin shell closed before answering.")));
                });
            })
            .on('error', (err: any) => {
                finish(new Error(err?.level === 'client-authentication'
                    ? 'The reader rejected the admin login.'
                    : `Could not open the reader's admin shell at ${host}: ${err?.message || err}`));
            })
            .on('keyboard-interactive', (_n: any, _i: any, _l: any, prompts: any[], reply: (a: string[]) => void) => reply(prompts.map(() => password)))
            .connect({ host, port: 22, username, password, tryKeyboard: true, readyTimeout: 8000 });
    });
}
