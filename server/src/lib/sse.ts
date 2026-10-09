// Native Server-Sent Events hub. No socket.io.
import { Response } from 'express';

interface Client { res: Response; school_id: string }
const clients = new Set<Client>();

export function addClient(res: Response, school_id: string) {
  const client: Client = { res, school_id };
  clients.add(client);
  res.on('close', () => clients.delete(client));
}

export function broadcast(school_id: string, data: unknown) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.school_id === school_id) c.res.write(payload);
}

// keep proxies / browsers from closing idle connections
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000);
