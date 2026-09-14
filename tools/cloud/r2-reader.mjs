import { AwsClient } from 'aws4fetch';

// Cross-account reads keep the public gateway on Workers Free while the existing
// private bucket stays in place. Never hand the S3 credentials or signed URL to a client.
export function createR2Reader(env, fetcher = fetch) {
  if (!/^[a-f0-9]{32}$/.test(env.R2_STORAGE_ACCOUNT || '') ||
      !/^[-a-z0-9]+$/.test(env.R2_BUCKET || '') ||
      !env.R2_READ_ACCESS_KEY_ID || !env.R2_READ_SECRET_ACCESS_KEY) return null;
  const client = new AwsClient({
    accessKeyId: env.R2_READ_ACCESS_KEY_ID,
    secretAccessKey: env.R2_READ_SECRET_ACCESS_KEY,
    service: 's3', region: 'auto', retries: 0,
  });
  return { async get(name) {
    if (!/^[-a-z0-9.]+$/.test(name)) throw Error('Invalid object name');
    const url = `https://${env.R2_STORAGE_ACCOUNT}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${name}`;
    // Sign then fetch exactly once: SDK retries and redirects would break the
    // relationship between the daily Worker cap and monthly R2 read allowance.
    const request = await client.sign(url, { method: 'GET', redirect: 'manual' });
    const response = await fetcher(request);
    if (response.status !== 200) { await response.body?.cancel(); throw Error('Storage unavailable: HTTP '+response.status); }
    const size = Number(response.headers.get('Content-Length'));
    if (!Number.isSafeInteger(size) || size <= 0) { await response.body?.cancel(); throw Error('Invalid object size'); }
    return { size, body: response.body };
  } };
}
