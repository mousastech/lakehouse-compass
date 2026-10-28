import type { Application, Request, Response } from 'express';
import { userEmail } from '../agent/agent-routes';
import { isAdmin, listAdmins, normEmail, recordAdmin, validEmail } from '../lib/admins';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export function setupAdminRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    // Effective admins + whether the caller is one (drives the Settings card).
    app.get('/api/admins', async (req: Request, res: Response) => {
      try {
        const me = normEmail(userEmail(req));
        const list = await listAdmins();
        const meAdmin = list.managers.includes(me) || list.registered.some((r) => r.email === me);
        res.json({ ...list, me: { email: me, is_admin: meAdmin } });
      } catch (e) {
        res.status(500).json({ error: errMsg(e) });
      }
    });

    app.post('/api/admins', async (req: Request, res: Response) => {
      try {
        const actor = userEmail(req);
        if (!(await isAdmin(actor))) {
          res.status(403).json({ error: `Only Compass administrators can add administrators. ${actor} is not one.` });
          return;
        }
        const email = normEmail((req.body || {}).email);
        if (!validEmail(email)) {
          res.status(400).json({ error: 'invalid email' });
          return;
        }
        const list = await listAdmins();
        if (!list.registry_ready) {
          res.status(409).json({ error: 'The administrators table does not exist yet — run a Compass scan once to create it.' });
          return;
        }
        if (list.managers.includes(email) || list.registered.some((r) => r.email === email)) {
          res.status(409).json({ error: `${email} is already an administrator.` });
          return;
        }
        await recordAdmin('ADD', email, actor);
        res.json({ ok: true, email });
      } catch (e) {
        res.status(500).json({ error: errMsg(e) });
      }
    });

    app.post('/api/admins/remove', async (req: Request, res: Response) => {
      try {
        const actor = normEmail(userEmail(req));
        if (!(await isAdmin(actor))) {
          res.status(403).json({ error: `Only Compass administrators can remove administrators. ${actor} is not one.` });
          return;
        }
        const email = normEmail((req.body || {}).email);
        const list = await listAdmins();
        if (list.managers.includes(email)) {
          res.status(409).json({ error: `${email} holds CAN MANAGE on the app — change it in the app's permissions in Databricks.` });
          return;
        }
        if (!list.registered.some((r) => r.email === email)) {
          res.status(404).json({ error: `${email} is not a registered administrator.` });
          return;
        }
        if (email === actor) {
          res.status(409).json({ error: 'You cannot remove yourself — ask another administrator.' });
          return;
        }
        if (list.managers.length + list.registered.length <= 1) {
          res.status(409).json({ error: 'Compass needs at least one administrator.' });
          return;
        }
        await recordAdmin('REMOVE', email, actor);
        res.json({ ok: true, email });
      } catch (e) {
        res.status(500).json({ error: errMsg(e) });
      }
    });
  });
}
