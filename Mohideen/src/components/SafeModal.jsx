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
 */

import React from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SafeModal({
  children,
  edges = ["top", "left", "right"],
  contentStyle,
  // statusBarTranslucent keeps Android from shifting the modal window down by
  // the status bar height itself, which would double-count the inset we apply.
  statusBarTranslucent = true,
  ...modalProps
}) {
  const insets = useSafeAreaInsets();
  const has = (edge) => edges.includes(edge);

  return (
    <Modal statusBarTranslucent={statusBarTranslucent} {...modalProps}>
      <View
        style={[
          { flex: 1 },
          has("top")    && { paddingTop: insets.top },
          has("bottom") && { paddingBottom: insets.bottom },
          has("left")   && { paddingLeft: insets.left },
          has("right")  && { paddingRight: insets.right },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </Modal>
  );
}
