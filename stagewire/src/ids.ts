
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // base32 Crockford, małe litery

/** UUIDv7 (RFC 9562) jako 16 bajtów. */
export function uuidv7Bytes(now: number = Date.now()): Uint8Array {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ts = BigInt(now);
  b[0] = Number((ts >> 40n) & 0xffn);
  b[1] = Number((ts >> 32n) & 0xffn);
  b[2] = Number((ts >> 24n) & 0xffn);
  b[3] = Number((ts >> 16n) & 0xffn);
  b[4] = Number((ts >> 8n) & 0xffn);
  b[5] = Number(ts & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; // wersja 7
  b[8] = (b[8] & 0x3f) | 0x80; // wariant
  return b;
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export const ID_PATTERN = /^[a-z]{2,5}_[0-9a-z]+$/;

/** Nowy ID z prefiksem typu, np. eqi_01k…; nigdy nie jest używany ponownie. */
export function newId(prefix: string): string {
  return `${prefix}_${base32(uuidv7Bytes())}`;
}
