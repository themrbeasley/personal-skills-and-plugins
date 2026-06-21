// Context from the auth process, encrypted & stored in the auth token
// and provided to the McpAgent as this.props
export type Props = {
	email: string;
	name: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number; // Unix timestamp (ms) when accessToken expires
};

/**
 * Constructs a Google OAuth 2.0 authorization URL.
 */
export function getUpstreamAuthorizeUrl({
	upstream_url,
	client_id,
	scope,
	redirect_uri,
	state,
}: {
	upstream_url: string;
	client_id: string;
	scope: string;
	redirect_uri: string;
	state?: string;
}) {
	const upstream = new URL(upstream_url);
	upstream.searchParams.set("client_id", client_id);
	upstream.searchParams.set("redirect_uri", redirect_uri);
	upstream.searchParams.set("scope", scope);
	upstream.searchParams.set("response_type", "code");
	// Google-specific: request offline access for refresh token
	upstream.searchParams.set("access_type", "offline");
	// Force consent to always get a refresh token
	upstream.searchParams.set("prompt", "consent");
	if (state) upstream.searchParams.set("state", state);
	return upstream.href;
}

/**
 * Token response from Google's OAuth 2.0 token endpoint.
 */
export interface GoogleTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	token_type: string;
	scope: string;
	id_token?: string;
}

/**
 * Exchanges an authorization code for tokens from Google.
 * Unlike GitHub (which returns form-encoded), Google returns JSON.
 */
export async function fetchUpstreamAuthToken({
	client_id,
	client_secret,
	code,
	redirect_uri,
}: {
	code: string | undefined;
	client_secret: string;
	redirect_uri: string;
	client_id: string;
}): Promise<[GoogleTokenResponse, null] | [null, Response]> {
	if (!code) {
		return [null, new Response("Missing code", { status: 400 })];
	}

	const resp = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id,
			client_secret,
			code,
			redirect_uri,
			grant_type: "authorization_code",
		}).toString(),
	});

	if (!resp.ok) {
		const errorText = await resp.text();
		console.error("Google token exchange failed:", errorText);
		return [null, new Response("Failed to fetch access token from Google", { status: 500 })];
	}

	const tokenData = (await resp.json()) as GoogleTokenResponse;
	if (!tokenData.access_token) {
		return [null, new Response("Missing access token in Google response", { status: 400 })];
	}

	return [tokenData, null];
}

/**
 * Decodes a Google ID token JWT to extract user info (email, name).
 * No verification needed since the token came directly from Google over HTTPS.
 */
export function decodeIdToken(idToken: string): { email: string; name: string } {
	const parts = idToken.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid ID token format");
	}
	// Base64url decode the payload (middle segment)
	const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
	const decoded = JSON.parse(atob(payload));
	return {
		email: decoded.email || "",
		name: decoded.name || decoded.email || "",
	};
}

/**
 * Refreshes a Google access token using the refresh token.
 */
export async function refreshAccessToken(
	refreshToken: string,
	clientId: string,
	clientSecret: string,
): Promise<{ accessToken: string; expiresAt: number }> {
	const resp = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}).toString(),
	});

	if (!resp.ok) {
		const errorText = await resp.text();
		throw new Error(`Token refresh failed: ${errorText}`);
	}

	const data = (await resp.json()) as { access_token: string; expires_in: number };
	return {
		accessToken: data.access_token,
		expiresAt: Date.now() + data.expires_in * 1000,
	};
}
