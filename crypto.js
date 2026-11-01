const enc = new TextEncoder();
const dec = new TextDecoder();
const IV_LENGTH = 12;

export async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBundle(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  const out = new Uint8Array(IV_LENGTH + data.byteLength);
  out.set(iv);
  out.set(new Uint8Array(data), IV_LENGTH);
  return out;
}

export async function decryptBundle(key, bytes) {
  const iv = bytes.slice(0, IV_LENGTH);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(IV_LENGTH));
  return JSON.parse(dec.decode(data));
}
