/**
 * Generate HMAC-SHA256 signature for webhook payloads.
 * Returns hex-encoded signature string.
 */
export async function signWebhookPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random webhook signing secret.
 * Format: whsec_ + 32 random hex chars
 */
export function generateSigningSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `whsec_${hex}`;
}
