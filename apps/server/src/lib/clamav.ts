import { connect, type Socket } from 'node:net';

export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string };

export interface Scanner {
  readonly name: string;
  scan(data: Buffer): Promise<ScanResult>;
}

/**
 * Minimal clamd client using the INSTREAM command (zero-terminated variant):
 *   "zINSTREAM\0" + [uint32 BE length + chunk]* + uint32 0
 * Replies: "stream: OK", "stream: <Signature> FOUND", or "... ERROR".
 * Any transport/protocol problem throws — callers must treat that as "not scanned" (fail closed).
 */
export class ClamdScanner implements Scanner {
  readonly name = 'clamd';
  constructor(private readonly opts: { host?: string; port: number; socket?: string; timeoutMs: number }) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket: Socket = this.opts.socket ? connect(this.opts.socket) : connect(this.opts.port, this.opts.host ?? '127.0.0.1');
      const chunks: Buffer[] = [];
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };
      socket.setTimeout(this.opts.timeoutMs, () => done(() => reject(new Error('clamd timeout'))));
      socket.on('error', (err) => done(() => reject(err)));
      socket.on('data', (c) => chunks.push(c));
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
        done(() => {
          if (/^stream: OK$/.test(reply)) return resolve({ status: 'clean' });
          const found = /^stream: (.+) FOUND$/.exec(reply);
          if (found) return resolve({ status: 'infected', signature: found[1]!.slice(0, 200) });
          reject(new Error(`clamd unexpected reply: ${reply.slice(0, 200)}`));
        });
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const CHUNK = 64 * 1024;
        for (let off = 0; off < data.length; off += CHUNK) {
          const part = data.subarray(off, off + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
      });
    });
  }
}

/** DEVELOPMENT ONLY — never enabled in production (enforced by config validation). */
export class UnsafeNoopScanner implements Scanner {
  readonly name = 'disabled-unsafe';
  async scan(): Promise<ScanResult> {
    return { status: 'clean' };
  }
}
