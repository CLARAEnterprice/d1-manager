export async function onRequest(context) {
  const { request, env, next } = context;

  console.log('>>> Middleware eseguito:', context.request.url);
  
  // Notifica in background, non blocca la risposta
  context.waitUntil(notifyAccess(request, env));

  return next();
}

async function notifyAccess(request, env) {
  console.log('>>> notifyAccess avviata');
  console.log('>>> NOTIFICATION_WEBHOOK_URL:', env.NOTIFICATION_WEBHOOK_URL);
  console.log('>>> NTFY_TOKEN presente:', !!env.NTFY_TOKEN);

  const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
  const ntfyToken = env.NTFY_TOKEN;

  if (!webhookUrl || !ntfyToken) {
    console.log('>>> STOP: variabili mancanti');
    return;
  }

  const accept = request.headers.get('Accept') || '';
  console.log('>>> Accept ricevuto:', accept);

  if (!accept.includes('text/html')) {
    console.log('>>> STOP: Accept non contiene text/html');
    return;
  }

  const userEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  const ip = request.headers.get('CF-Connecting-IP') || 'sconosciuto';
  const path = new URL(request.url).pathname;
  const timestamp = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

  const isAuthenticated = !!userEmail;
  const priority = isAuthenticated ? '2' : '5';
  const title = isAuthenticated ? '🔐 Accesso al DB' : '⚠️ Accesso sconosciuto al DB';

  console.log('>>> Utente:', userEmail || 'sconosciuto', '| Priorità:', priority);

  const body = [
    `Utente: ${userEmail || 'sconosciuto'}`,
    `IP: ${ip}`,
    `Pagina: ${path}`,
    `Ora: ${timestamp}`
  ].join('\n');

  try {
    console.log('>>> Invio fetch a:', webhookUrl);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ntfyToken}`,
        'Title': title,
        'Priority': priority,
        'Tags': isAuthenticated ? 'lock' : 'warning'
      },
      body
    });
    console.log('>>> Risposta ntfy:', response.status, response.statusText);
  } catch (err) {
    console.error('>>> ERRORE fetch:', err.message);
  }
}
