import app from '../../src/server/app';

// Simule un navigateur : renvoie les cookies reçus à chaque requête
export function createClient() {
  const jar = new Map<string, string>();
  return async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, value] = pair.split('=');
      if (header.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
}
