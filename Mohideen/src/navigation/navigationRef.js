import { createNavigationContainerRef, CommonActions } from "@react-navigation/native";

// Lets code outside the React tree (e.g. the axios/fetch wrappers in
// config/server.js, which run inside plain module functions with no
// `navigation` prop) trigger navigation — specifically, forcing the app back
// to the Login screen when a session is found to be invalid mid-request.
export const navigationRef = createNavigationContainerRef();

/**
 * Reset the navigation stack to Login, discarding the whole back stack so the
 * user can't navigate "back" into a screen that depends on the now-invalid
 * session. Passes params LoginScreen reads to show a friendly explanation.
 */
export function resetToLogin(params) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: "Login", params }],
    })
  );
}
