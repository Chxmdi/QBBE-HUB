import net from "node:net";

/**
 * Tiny SMTP client for local Mailpit (`supabase start` exposes SMTP on
 * :54325). Production providers are configured via EMAIL_PROVIDER_API_KEY
 * and are not faked here (DONE-010).
 */
export async function sendSmtpMail(options: {
  host: string;
  port: number;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const { host, port, from, to, subject, text } = options;

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setEncoding("utf8");
    let buffer = "";
    const queue = [
      `EHLO qbbe-hub.local`,
      `MAIL FROM:<${envelopeAddress(from)}>`,
      `RCPT TO:<${envelopeAddress(to)}>`,
      `DATA`,
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${encodeHeader(subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n.`,
      `QUIT`,
    ];
    let i = 0;
    const timeout = setTimeout(() => {
      socket.destroy(new Error("SMTP timeout"));
    }, 12_000);

    function fail(err: Error) {
      clearTimeout(timeout);
      socket.destroy();
      reject(err);
    }

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      const code = Number(last.slice(0, 3));
      if (!code) return;
      // Multi-line replies use "250-" until the final "250 ".
      if (last[3] === "-") return;
      buffer = "";
      if (code >= 400) {
        fail(new Error(`SMTP ${last}`));
        return;
      }
      if (i >= queue.length) {
        clearTimeout(timeout);
        socket.end();
        resolve();
        return;
      }
      socket.write(`${queue[i]}\r\n`);
      i += 1;
      if (i >= queue.length) {
        // Final QUIT response will complete.
      }
    });
    socket.on("error", (err) => fail(err));
    socket.on("end", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/**
 * The bare address for the SMTP envelope. A header may say
 * "QBBE Hub <hub@localhost>", but MAIL FROM and RCPT TO take only the address
 * inside the brackets; the whole string is a syntax error to the server.
 */
export function envelopeAddress(value: string): string {
  const match = value.match(/<([^<>]+)>\s*$/);
  return (match ? match[1] : value).trim();
}

/**
 * A header value that survives any mail server. A French subject ("1 mise à
 * jour en attente…") is not ASCII, and raw 8-bit bytes in a header are
 * outside the SMTP standard, so non-ASCII subjects go out RFC 2047-encoded.
 * Plain ASCII is left as it is, so English subjects read exactly as before.
 */
export function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
