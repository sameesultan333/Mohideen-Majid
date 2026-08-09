/**
 * Modal that respects the device's safe area.
 *
 * Use this everywhere instead of React Native's Modal.
 *
 * Why it exists
 * -------------
 * App.jsx wraps the whole navigator in a SafeAreaView, so every screen already
 * starts below the status bar and display cutout. A Modal, however, is rendered
 * by the platform in its OWN window, outside that hierarchy — so it inherits
 * none of it and draws edge to edge. From targetSdk 35 Android enforces
 * edge-to-edge, which means any modal content near the top of the screen ends
 * up underneath the status bar: bottom sheets tall enough to reach the top,
 * full-screen pickers, and anything absolutely positioned at the top.
 *
 * Rather than remembering the inset in each of the two dozen modals in this app
 * (and in every one added later), this wrapper applies it once. Import SafeModal
 * and the safe area is handled — there is nothing per-screen to get right.
 *
 * `edges` lets a modal opt out if it genuinely wants to paint edge to edge
 * (a fullscreen image viewer, say): pass edges={[]}.
 *
 * `topColor`
 * ----------
 * Because the modal window is translucent behind the status bar, the inset
 * strip this component reserves is left *unpainted* and the system icons keep
 * whatever appearance the screen underneath asked for. A modal with a light
 * surface opening over a dark-headed screen therefore got white icons on a
 * white strip — invisible — and its own header appeared to start at the very
 * top of the display, reading as "the header is not below the status bar".
 *
 * Passing the colour of the modal's own top edge paints the strip and picks
 * the readable icon style from it, using the same derivation as the rest of
 * the app (theme/statusBar). Nothing is hardcoded and nothing is forced: omit
 * it and the previous edge-to-edge behaviour is unchanged.
 */

import React from "react";
import { Modal, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { barStyleFor } from "../theme/statusBar";

export default function SafeModal({
  children,
  edges = ["top", "left", "right"],
  contentStyle,
  topColor,
  // Must match the app shell's own StatusBar, which is translucent={false}.
  //
  // With a non-translucent status bar Android insets the *app* window, so the
  // root view already starts below the bar and useSafeAreaInsets() reports
  // top: 0. Forcing the modal's window translucent broke that pairing: the
  // modal became full-screen while the inset it padded with was zero, so its
  // header drew underneath the status bar. Leaving it false lets Android inset
  // the modal window the same way it insets the app, and the paddingTop below
  // stays a no-op instead of double-counting.
  //
  // A modal that genuinely wants to paint edge to edge passes true explicitly
  // together with edges={[]}.
  statusBarTranslucent = false,
  ...modalProps
}) {
  const insets = useSafeAreaInsets();
  const has = (edge) => edges.includes(edge);
  const paintsTop = has("top") && !!topColor;

  return (
    <Modal statusBarTranslucent={statusBarTranslucent} {...modalProps}>
      {/* Rendered inside the modal so it applies only while the modal is up,
          and unwinds to the screen's own bar when it closes. */}
      {paintsTop && modalProps.visible !== false && (
        <StatusBar barStyle={barStyleFor(topColor)} backgroundColor={topColor} />
      )}
      <View
        style={[
          { flex: 1 },
          has("top")    && { paddingTop: insets.top },
          has("bottom") && { paddingBottom: insets.bottom },
          has("left")   && { paddingLeft: insets.left },
          has("right")  && { paddingRight: insets.right },
          paintsTop     && { backgroundColor: topColor },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </Modal>
  );
}
