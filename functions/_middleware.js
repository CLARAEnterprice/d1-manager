export async function onRequest(context) {
  const { request, env, next } = context;

  console.log('Middleware eseguito:', context.request.url);
  
  // Notifica in background, non blocca la risposta
  context.waitUntil(notifyAccess(request, env));

  return next();
}

async function notifyAccess(request, env) {
  const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
  const ntfyToken = env.NTFY_TOKEN;

  if (!webhookUrl || !ntfyToken) {
    console.log('NOTIFICATION_WEBHOOK_URL o NTFY_TOKEN non configurati');
    return;
  }

  // Notifica solo le richieste HTML (accessi reali alla pagina)
  // Esclude CSS, JS, immagini e altre risorse statiche
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return;

  // Identità utente da Cloudflare Access
  const userEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  const ip = request.headers.get('CF-Connecting-IP') || 'sconosciuto';
  const path = new URL(request.url).pathname;
  const timestamp = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

  // Priorità condizionale: 2 se autenticato, 5 se sconosciuto
  const isAuthenticated = !!userEmail;
  const priority = isAuthenticated ? '2' : '5';
  const title = isAuthenticated
    ? '🔐 Accesso al DB'
    : '⚠️ Accesso sconosciuto al DB';

  const body = [
    `Utente: ${userEmail || 'sconosciuto'}`,
    `IP: ${ip}`,
    `Pagina: ${path}`,
    `Ora: ${timestamp}`
  ].join('\n');

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ntfyToken}`,
        'Title': title,
        'Priority': priority,
        'Tags': isAuthenticated ? 'lock' : 'warning'
      },
      body
    });
  } catch (err) {
    console.error('Errore notifica accesso:', err.message);
  }
}
