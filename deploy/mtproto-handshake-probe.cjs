#!/usr/bin/env node
/**
 * Testgram MTProto handshake probe — run on the LXC host.
 *
 * Opens ws://127.0.0.1:30444/apiws, sends ReqPqMulti, expects ResPQ within 10s.
 * If this fails, the web client cannot log in (check auth-server, rabbitmq, redis).
 *
 * Usage:
 *   node deploy/mtproto-handshake-probe.cjs
 *   node deploy/mtproto-handshake-probe.cjs ws://127.0.0.1:30444/apiws
 */

const crypto = require('crypto');

let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  console.error('Install ws first: npm install -g ws   OR   npm install ws in this directory');
  process.exit(1);
}

const REQ_PQ_MULTI = 0xbe7e8ef1;
const ABRIDGED_TAG = Buffer.from('efefefef', 'hex');

function generateRandomBytes(n) {
  return crypto.randomBytes(n);
}

function readBigIntFromBuffer(buf, little = true) {
  return little ? buf.readBigInt64LE(0) : buf.readBigUInt64BE(0);
}

function toSignedLittleBuffer(value, bytes) {
  const buf = Buffer.alloc(bytes);
  buf.writeBigInt64LE(value);
  return buf;
}

// Ported from gramjs TCPObfuscated / CTR
class CTR {
  constructor(key, iv) {
    this.key = key;
    this.iv = iv;
    this.blockSize = 16;
    this.offset = 0;
    this.buffer = Buffer.alloc(0);
    this.encryptCipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  }

  encrypt(buf) {
    return this.encryptCipher.update(buf);
  }
}

function buildObfuscatedHeader() {
  const keywords = [
    Buffer.from('50567247', 'hex'),
    Buffer.from('474554', 'hex'),
    Buffer.from('504f5354', 'hex'),
    Buffer.from('eeeeeeee', 'hex'),
  ];

  let random;
  while (true) {
    random = generateRandomBytes(64);
    if (random[0] === 0xef) continue;
    if (random.slice(4, 8).equals(Buffer.alloc(4))) continue;
    if (keywords.some((k) => k.equals(random.slice(0, 4)))) continue;
    break;
  }

  const randomReversed = Buffer.from(random.slice(8, 56)).reverse();
  const encryptKey = Buffer.from(random.slice(8, 40));
  const encryptIv = Buffer.from(random.slice(40, 56));
  const decryptKey = Buffer.from(randomReversed.slice(0, 32));
  const decryptIv = Buffer.from(randomReversed.slice(32, 48));
  const encryptor = new CTR(encryptKey, encryptIv);
  const decryptor = new CTR(decryptKey, decryptIv);

  let packet = Buffer.concat([
    Buffer.from(random.slice(0, 56)),
    ABRIDGED_TAG,
    Buffer.from(random.slice(60)),
  ]);
  packet = Buffer.concat([
    Buffer.from(packet.slice(0, 56)),
    encryptor.encrypt(packet).slice(56, 64),
    Buffer.from(packet.slice(64)),
  ]);

  return { header: packet, encryptor, decryptor };
}

function buildReqPqMulti() {
  const nonce = generateRandomBytes(16);
  const body = Buffer.alloc(20);
  body.writeUInt32LE(REQ_PQ_MULTI, 0);
  nonce.copy(body, 4);

  const now = Date.now() / 1000;
  const msgId = (BigInt(Math.floor(now)) << 32n) | 4n;
  const msgIdBuf = toSignedLittleBuffer(msgId, 8);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeInt32LE(body.length, 0);

  const plain = Buffer.concat([Buffer.alloc(8), msgIdBuf, lenBuf, body]);
  const abridgedLen = plain.length >> 2;
  const prefix = abridgedLen < 127
    ? Buffer.from([abridgedLen])
    : Buffer.concat([Buffer.from([0x7f]), Buffer.alloc(3)]);

  return Buffer.concat([prefix, plain]);
}

function encodePacket(data, encryptor) {
  return encryptor.encrypt(data);
}

async function probe(url) {
  console.log(`Probing MTProto handshake on ${url}`);

  return new Promise((resolve, reject) => {
    const { header, encryptor } = buildObfuscatedHeader();
    const ws = new WebSocket(url, 'binary');
    let gotResponse = false;

    const timer = setTimeout(() => {
      if (!gotResponse) {
        ws.terminate();
        reject(new Error('Timeout waiting for ResPQ (auth-server or RabbitMQ likely down)'));
      }
    }, 10000);

    ws.on('open', () => {
      ws.send(header);
      const packet = encodePacket(buildReqPqMulti(), encryptor);
      ws.send(packet);
    });

    ws.on('message', (data) => {
      gotResponse = true;
      clearTimeout(timer);
      const buf = Buffer.from(data);
      console.log(`OK: received ${buf.length} bytes from server (MTProto handshake works)`);
      ws.close();
      resolve(true);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const url = process.argv[2] || 'ws://127.0.0.1:30444/apiws';

probe(url)
  .then(() => {
    console.log('PASS — gateway + auth-server path is healthy');
    process.exit(0);
  })
  .catch((err) => {
    console.error('FAIL —', err.message);
    console.error('Check: docker compose ps auth-server gateway-server rabbitmq redis');
    console.error('Logs:  docker compose logs --tail=100 auth-server gateway-server');
    process.exit(1);
  });