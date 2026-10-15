import { extend } from "$lib/log";
import { DBMS } from "$lib/server/db/dbms";
import type { Handle, HandleServerError } from "@sveltejs/kit";
import { locale, waitLocale } from "svelte-i18n";

export const handle: Handle = async ({ event, resolve }) => {
	const lang = event.request.headers.get("accept-language")?.split(",")[0] || "en";
	locale.set(lang);
	await waitLocale(lang);

	event.locals.db = DBMS(event.platform?.env || {});

	// --- NOTIFICA DI ACCESSO (aggiunto) ---
	const ctx = (event.platform as any)?.ctx || (event.platform as any)?.context;
	if (ctx?.waitUntil) {
		ctx.waitUntil(notifyAccess(event));
	} else {
		// Fallback se ctx non è disponibile: esegui in modo sincrono
		await notifyAccess(event);
	}

	const result = await resolve(event);
	return result;
};

const elog = extend("server-error");
elog.enabled = true;

export const handleError: HandleServerError = async ({ error }) => {
	elog(error);

	if (error instanceof Error && error.message.startsWith("D1_")) {
		return {
			code: 400,
			message: error.message,
		};
	}

	return {
		code: 500,
		message: "Internal Server Error",
	};
};

// Cache in-memory: evita notifiche ripetute dallo stesso utente/IP
const notifiedRecently = new Map<string, number>();
const NOTIFY_WINDOW_MS = 10 * 60 * 1000; // 10 minuti

function shouldNotify(key: string): boolean {
	const now = Date.now();
	const last = notifiedRecently.get(key);

	// Pulisci le voci scadute ogni tanto (evita memory leak)
	if (notifiedRecently.size > 100) {
		for (const [k, t] of notifiedRecently) {
			if (now - t > NOTIFY_WINDOW_MS) notifiedRecently.delete(k);
		}
	}

	if (!last || now - last > NOTIFY_WINDOW_MS) {
		notifiedRecently.set(key, now);
		return true;
	}
	return false;
}

async function notifyAccess(event: any) {
	const env = event.platform?.env || {};
	const request = event.request;

	// Solo navigazioni (esclude fetch API, prefetch, asset)
	const secFetchDest = request.headers.get('sec-fetch-dest');
	if (secFetchDest !== 'document') return;

	if (request.method !== 'GET') return;

	const path = new URL(request.url).pathname;
	if (path.match(/\.(css|js|mjs|png|jpg|jpeg|svg|ico|woff|woff2|ttf|map|json|txt|xml|webp|avif)$/)) {
		return;
	}

	const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
	const ntfyToken = env.NTFY_TOKEN;
	if (!webhookUrl || !ntfyToken) return;

	// --- IDENTITÀ UTENTE ---
	let userEmail = request.headers.get('Cf-Access-Authenticated-User-Email');

	if (!userEmail) {
		const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
		if (jwt) {
			try {
				const payloadBase64 = jwt.split('.')[1];
				const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
				const payload = JSON.parse(atob(base64));
				userEmail = payload.email || null;
			} catch {
				// Ignora errori di decodifica
			}
		}
	}

	const ip = request.headers.get('CF-Connecting-IP') || 'sconosciuto';
	const isAuthenticated = !!userEmail;

	// Chiave per rate limit: email se disponibile, altrimenti IP
	const rateKey = userEmail || `ip:${ip}`;

	if (!shouldNotify(rateKey)) return;

	const timestamp = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
	const priority = isAuthenticated ? '2' : '5';
	const title = isAuthenticated ? 'Accesso al DB' : 'Accesso sconosciuto al DB';
	const tags = isAuthenticated ? 'lock' : 'warning';

	const body = [
		`Utente: ${userEmail || 'sconosciuto'}`,
		`IP: ${ip}`,
		`Pagina: ${path}`,
		`Ora: ${timestamp}`
	].join('\n');

	try {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ntfyToken}`,
				Title: title,
				Priority: priority,
				Tags: tags
			},
			body
		});

		if (!response.ok) {
			console.error(`Errore notifica: ${response.status} ${response.statusText}`);
		}
	} catch (err) {
		console.error('Errore fetch ntfy:', (err as Error).message);
	}
}
