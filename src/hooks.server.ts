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

// --- Funzione di notifica (aggiunta) ---
async function notifyAccess(event: any) {
	const env = event.platform?.env || {};
	const request = event.request;

	console.log(">>> Hook eseguito:", request.url);

	const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
	const ntfyToken = env.NTFY_TOKEN;

	if (!webhookUrl || !ntfyToken) {
		console.log(">>> STOP: variabili mancanti");
		return;
	}

	if (request.method !== "GET") return;

	const path = new URL(request.url).pathname;
	if (path.match(/\.(css|js|mjs|png|jpg|jpeg|svg|ico|woff|woff2|ttf|map|json|txt|xml)$/)) {
		return;
	}

	const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
	const ip = request.headers.get("CF-Connecting-IP") || "sconosciuto";
	const timestamp = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });

	const isAuthenticated = !!userEmail;
	const priority = isAuthenticated ? "2" : "5";
	const title = isAuthenticated
		? "🔐 Accesso al DB"
		: "⚠️ Accesso sconosciuto al DB";

	const body = [
		`Utente: ${userEmail || "sconosciuto"}`,
		`IP: ${ip}`,
		`Pagina: ${path}`,
		`Ora: ${timestamp}`,
	].join("\n");

	try {
		console.log(">>> Invio a:", webhookUrl);
		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ntfyToken}`,
				Title: title,
				Priority: priority,
				Tags: isAuthenticated ? "lock" : "warning",
			},
			body,
		});
		console.log(">>> Risposta ntfy:", response.status);
	} catch (err) {
		console.error(">>> Errore:", (err as Error).message);
	}
}
