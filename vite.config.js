import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load environment variables from .env into process.env for Node.js API handlers.
  // Non-VITE keys (SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_SECRET, ...) are server-only
  // secrets required by /api/* handlers. They are injected into the Node.js process
  // (server side only) — Vite never exposes non-VITE_* keys to the browser client.
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'SUPABASE_', 'BOOTSTRAP_']);
  for (const [key, val] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = val;
  }

  return {
    server: {
      host: '0.0.0.0',
      port: 3005,
    },
    preview: {
      host: '0.0.0.0',
      port: 3005,
    },
    plugins: [
      {
        name: 'api-server-middleware',
        configureServer(server) {
          setupApiMiddleware(server.middlewares);
        },
        configurePreviewServer(server) {
          setupApiMiddleware(server.middlewares);
        },
      },
    ],
  };
});

function setupApiMiddleware(middlewares) {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) {
      return next();
    }

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      return res;
    };

    let body = {};
    if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH') {
      try {
        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const data = Buffer.concat(buffers).toString();
        if (data) {
          body = JSON.parse(data);
        }
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    req.body = body;

    const pathname = req.url.split('?')[0];
    try {
      if (pathname === '/api/users') {
        const { default: usersHandler } = await import('./api/users.js');
        return await usersHandler(req, res);
      }
      if (pathname === '/api/invite') {
        const { default: inviteHandler } = await import('./api/invite.js');
        return await inviteHandler(req, res);
      }
      if (pathname === '/api/audit') {
        const { default: auditHandler } = await import('./api/audit.js');
        return await auditHandler(req, res);
      }
      if (pathname === '/api/register') {
        const { default: registerHandler } = await import('./api/register.js');
        return await registerHandler(req, res);
      }
      if (pathname === '/api/invoices') {
        const { default: invoicesHandler } = await import('./api/invoices.js');
        return await invoicesHandler(req, res);
      }
      if (pathname === '/api/payments') {
        const { default: paymentsHandler } = await import('./api/payments.js');
        return await paymentsHandler(req, res);
      }
      if (pathname === '/api/bootstrap-admin') {
        const { default: bootstrapHandler } = await import('./api/bootstrap-admin.js');
        return await bootstrapHandler(req, res);
      }
      return next();
    } catch (err) {
      console.error('API Error:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });
}
