/**
 * Secure token storage — wraps react-native-keychain.
 *
 * Authentication tokens (JWT) must never live in AsyncStorage.
 * Everything else (theme, language, cache, read-state) stays in AsyncStorage.
 *
 * Keychain service names:
 *   "mohideen_auth_token"  →  { username: "token", password: <jwt> }
 */
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE = 'mohideen_auth_token';
const REFRESH_SERVICE = 'mohideen_refresh_token';
const LEGACY_REFRESH_KEY = 'refresh_token';

/**
 * Save the JWT access token securely.
 */
export async function saveToken(token) {
  await Keychain.setGenericPassword('token', token, { service: SERVICE });
}

/**
 * Retrieve the JWT access token.
 * Returns null if not found or on error.
 */
export async function getToken() {
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (creds && creds.password) return creds.password;
    // Fallback: migrate from AsyncStorage if present (one-time migration)
    const legacy = await AsyncStorage.getItem('token');
    if (legacy) {
      await saveToken(legacy);
      await AsyncStorage.removeItem('token');
      return legacy;
    }
    return null;
  } catch {
    // Keychain unavailable (emulator without secure hardware) — fall back to AsyncStorage
    return AsyncStorage.getItem('token');
  }
}

/**
 * Delete the stored token on logout.
 */
export async function deleteToken() {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch { /* ignore */ }
  await AsyncStorage.removeItem('token');
}

export async function saveRefreshToken(token) {
  await Keychain.setGenericPassword('refresh', token, { service: REFRESH_SERVICE });
}

export async function getRefreshToken() {
  try {
    const creds = await Keychain.getGenericPassword({ service: REFRESH_SERVICE });
    if (creds && creds.password) return creds.password;

    // Older builds did not consistently put the refresh token in Keychain.
    // Migrate that value once so an app update does not force a new login.
    const legacy = await AsyncStorage.getItem(LEGACY_REFRESH_KEY);
    if (legacy) {
      try {
        await saveRefreshToken(legacy);
        await AsyncStorage.removeItem(LEGACY_REFRESH_KEY);
      } catch {
        // The legacy value is still usable for this refresh attempt.
      }
      return legacy;
    }
    return null;
  } catch (error) {
    // A temporary Keychain/Keystore error is not proof that the session was
    // revoked. Let the auth layer preserve the session and retry later.
    const legacy = await AsyncStorage.getItem(LEGACY_REFRESH_KEY);
    if (legacy) return legacy;
    throw error;
  }
}

export async function deleteRefreshToken() {
  try {
    await Keychain.resetGenericPassword({ service: REFRESH_SERVICE });
  } catch { /* ignore */ }
}
