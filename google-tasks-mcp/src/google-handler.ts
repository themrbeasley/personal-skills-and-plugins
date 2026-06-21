import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, decodeIdToken, type Props } from "./utils";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// GET /authorize - Show approval dialog or redirect if already approved
app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	// Check if client is already approved
	if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
		return redirectToGoogle(c.req.raw, c.env, stateToken, { "Set-Cookie": sessionBindingCookie });
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: {
			description: "Connect Claude to your Google Tasks for task management.",
			name: "Google Tasks MCP Server",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

// POST /authorize - Handle approval form submission
app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();
		validateCSRFToken(formData, c.req.raw);

		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
			return c.text("Invalid request", 400);
		}

		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			c.env.COOKIE_ENCRYPTION_KEY,
		);

		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

		const headers = new Headers();
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionBindingCookie);

		return redirectToGoogle(c.req.raw, c.env, stateToken, Object.fromEntries(headers));
	} catch (error: any) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text(`Internal server error: ${error.message}`, 500);
	}
});

/**
 * Redirect to Google's OAuth consent screen.
 * Key differences from GitHub:
 * - Uses Google's OAuth 2.0 authorize endpoint
 * - Requests tasks + openid + email scopes
 * - access_type=offline and prompt=consent for refresh token
 */
async function redirectToGoogle(
	request: Request,
	env: Env,
	stateToken: string,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.GOOGLE_CLIENT_ID,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "https://www.googleapis.com/auth/tasks openid email",
				state: stateToken,
				upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
			}),
		},
		status: 302,
	});
}

/**
 * OAuth Callback from Google.
 * Key differences from GitHub:
 * - Google returns JSON tokens (not form-encoded)
 * - We get access_token, refresh_token, expires_in, and id_token
 * - User info comes from decoding the id_token (no extra API call)
 */
app.get("/callback", async (c) => {
	let oauthReqInfo: AuthRequest;
	let clearSessionCookie: string;

	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearSessionCookie = result.clearCookie;
	} catch (error: any) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	// Exchange the authorization code for Google tokens
	const [tokenData, errResponse] = await fetchUpstreamAuthToken({
		client_id: c.env.GOOGLE_CLIENT_ID,
		client_secret: c.env.GOOGLE_CLIENT_SECRET,
		code: c.req.query("code"),
		redirect_uri: new URL("/callback", c.req.url).href,
	});
	if (errResponse) return errResponse;

	// Extract user info from the ID token
	let email = "unknown";
	let name = "Unknown User";
	if (tokenData.id_token) {
		const userInfo = decodeIdToken(tokenData.id_token);
		email = userInfo.email;
		name = userInfo.name;
	}

	// Complete the MCP authorization with Google tokens stored as props
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: { label: name },
		props: {
			email,
			name,
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token || "",
			expiresAt: Date.now() + tokenData.expires_in * 1000,
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: email,
	});

	const headers = new Headers({ Location: redirectTo });
	if (clearSessionCookie) {
		headers.set("Set-Cookie", clearSessionCookie);
	}

	return new Response(null, { status: 302, headers });
});

export { app as GoogleHandler };
