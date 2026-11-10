import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const TOKEN_KEY = "admin_token";
const REFRESH_TOKEN_KEY = "admin_refresh_token";
const ADMIN_DATA_KEY = "admin_data";
const REFRESH_PATH = "/admin/auth/refresh";
export const ADMIN_TOKEN_REFRESHED_EVENT = "admin-token-refreshed";

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        "Content-Type": "application/json",
    },
});

// Request interceptor to add Auth Token
api.interceptors.request.use((config) => {
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ─────────────────────────────────────────────────────────────────────────────
// Silent refresh with concurrent-request queue
//
// When several requests fire simultaneously and all get 401, only the first
// one triggers the refresh call. The others await the same in-flight promise
// and then retry with the fresh token. Prevents thundering-herd against
// /admin/auth/refresh and avoids multiple logout bounces.
// ─────────────────────────────────────────────────────────────────────────────
let refreshPromise: Promise<string> | null = null;

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean };

function clearAuthStorage() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(ADMIN_DATA_KEY);
}

function bounceToLogin() {
    clearAuthStorage();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
    }
}

async function performRefresh(): Promise<string> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
        throw new Error("No refresh token available");
    }

    // Use a raw axios call to bypass our own interceptors and avoid loops.
    const response = await axios.post(
        `${API_URL}${REFRESH_PATH}`,
        {},
        {
            headers: {
                Authorization: `Bearer ${refreshToken}`,
                "Content-Type": "application/json",
            },
        },
    );

    const { accessToken, refreshToken: newRefreshToken } = response.data ?? {};
    if (!accessToken) {
        throw new Error("Refresh response missing accessToken");
    }

    localStorage.setItem(TOKEN_KEY, accessToken);
    if (newRefreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
    }

    // Let AuthContext (and any other listeners) re-sync from localStorage.
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(ADMIN_TOKEN_REFRESHED_EVENT));
    }

    return accessToken;
}

function getRefreshPromise(): Promise<string> {
    if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
            // Clear regardless of success/failure so the next 401 can re-attempt.
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

// Response interceptor for enhanced global error handling
api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as RetriableRequest | undefined;
        const status = error.response?.status;
        const message = (error.response?.data as { message?: string } | undefined)?.message;

        // SSR / non-browser: just reject.
        if (typeof window === "undefined") {
            return Promise.reject(error);
        }

        // 401 Unauthorized → try silent refresh, then retry original request.
        if (status === 401 && originalRequest) {
            // If the refresh endpoint itself returned 401, the refresh token is
            // dead. Short-circuit and bounce immediately — no retry loop.
            if (originalRequest.url?.includes(REFRESH_PATH)) {
                bounceToLogin();
                return Promise.reject(error);
            }

            // Prevent infinite retry on the same request.
            if (originalRequest._retry) {
                bounceToLogin();
                return Promise.reject(error);
            }

            const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
            if (!refreshToken) {
                // Nothing to refresh with — show a hint and bounce. We suppress
                // the toast on the login page itself to avoid noise during a
                // failed login attempt (which also returns 401).
                if (window.location.pathname !== "/login") {
                    toast.error("Session expired. Please log in again.");
                    bounceToLogin();
                }
                return Promise.reject(error);
            }

            originalRequest._retry = true;

            try {
                const newToken = await getRefreshPromise();
                if (originalRequest.headers) {
                    originalRequest.headers.Authorization = `Bearer ${newToken}`;
                }
                return api(originalRequest);
            } catch (refreshError) {
                console.error("Token refresh failed:", refreshError);
                if (window.location.pathname !== "/login") {
                    toast.error("Session expired. Please log in again.");
                }
                bounceToLogin();
                return Promise.reject(error);
            }
        }

        // 403 Forbidden - Insufficient permissions
        if (status === 403) {
            toast.error("You don't have permission to perform this action");
        }

        // 404 Not Found
        if (status === 404) {
            // Don't show toast for 404 on login/refresh if handled elsewhere
            if (!originalRequest?.url?.includes("/auth/")) {
                toast.error(message || "Resource not found");
            }
        }

        // 500 Internal Server Error
        if (status === 500) {
            toast.error("Server error. Please try again later.");
        }

        // Network errors (no response from server)
        if (!error.response) {
            toast.error("Network error. Check your connection.");
        }

        return Promise.reject(error);
    },
);
