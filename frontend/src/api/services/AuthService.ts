/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AccessToken } from '../models/AccessToken';
import type { Body_login_for_access_token_token_post } from '../models/Body_login_for_access_token_token_post';
import type { RefreshTokenRequest } from '../models/RefreshTokenRequest';
import type { Token } from '../models/Token';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AuthService {
    /**
     * Login — obtain access + refresh tokens
     * Authenticate with `username` and `password` (form-data, **not** JSON).
     *
     * Returns:
     * - `access_token` — short-lived JWT (30 min by default). Use as `Authorization: Bearer <token>`.
     * - `refresh_token` — long-lived JWT (7 days). Use at `POST /token/refresh` to rotate the access token.
     *
     * **Brute-force protection:** account is locked for 15 minutes after 5 failed attempts.
     * @param formData
     * @returns Token Tokens issued successfully
     * @throws ApiError
     */
    public static loginForAccessTokenTokenPost(
        formData: Body_login_for_access_token_token_post,
    ): CancelablePromise<Token> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/token',
            formData: formData,
            mediaType: 'application/x-www-form-urlencoded',
            errors: {
                401: `Invalid credentials`,
                422: `Validation Error`,
                423: `Account temporarily locked`,
            },
        });
    }
    /**
     * Refresh — exchange a refresh token for a new access token
     * Send a valid `refresh_token` in the JSON body to receive a fresh `access_token`.
     *
     * The refresh token itself is **not** rotated — it remains valid until it expires (7 days).
     * @param requestBody
     * @returns AccessToken New access token issued
     * @throws ApiError
     */
    public static refreshAccessTokenTokenRefreshPost(
        requestBody: RefreshTokenRequest,
    ): CancelablePromise<AccessToken> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/token/refresh',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Refresh token invalid or expired`,
                422: `Validation Error`,
            },
        });
    }
}
