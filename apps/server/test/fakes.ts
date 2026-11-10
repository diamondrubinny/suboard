import { createServer, type AddressInfo, type Server } from 'node:net';

/**
 * Harmless stand-in for a malware signature. The real EICAR string is deliberately NOT used so
 * that cloning this repository never trips a developer's antivirus.
 */
export const TEST_MALWARE_MARKER = 'SUBOARD-TEST-MALWARE-MARKER';

/** Fake clamd speaking the real INSTREAM protocol; flags payloads containing the marker. */
export async function startFakeClamd(): Promise<{ port: number; server: Server; scans: number[] }> {
  const scans: number[] = [];
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let commandRead = false;
    const body: Buffer[] = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!commandRead) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        if (buf.subarray(0, nul).toString() !== 'zINSTREAM') {
          socket.end('UNKNOWN COMMAND\0');
          return;
        }
        commandRead = true;
        buf = buf.subarray(nul + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const data = Buffer.concat(body);
          scans.push(data.length);
          socket.end(data.includes(TEST_MALWARE_MARKER) ? 'stream: Test.Marker FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) return;
        body.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, server, scans };
}

// Minimal valid-looking file headers for type detection.
export const files = {
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]),
  pdf: Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'),
  exe: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]),
  html: Buffer.from('<html><script>alert(1)</script></html>'),
};
