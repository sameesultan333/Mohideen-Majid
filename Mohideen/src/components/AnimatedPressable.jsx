// components/AnimatedPressable.jsx
// Drop-in replacement for TouchableOpacity across the app: same props,
// same API — adds a subtle press-in/press-out scale (matching the pattern
// already used by BottomNav's TabButton) and defaults activeOpacity to a
// sane value instead of RN's default 0.2.
//
// Root-caused fix for the "black overlay on press" complaint: there is no
// TouchableHighlight/underlayColor or android_ripple in this app — the
// dark flash came from TouchableOpacity's default activeOpacity (0.2)
// making translucent-background buttons (a common pattern here, e.g.
// header icon buttons with rgba(255,255,255,0.12) backgrounds) nearly
// fully transparent on press, exposing the dark screen background
// underneath. Defaulting to 0.85 keeps a visible-but-subtle press state.
import React, { useRef } from "react";
import { Animated, TouchableOpacity } from "react-native";

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

export default function AnimatedPressable({
  style,
  activeOpacity = 0.85,
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  ...rest
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e) => {
    Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
    onPressIn?.(e);
  };
  const handlePressOut = (e) => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
    onPressOut?.(e);
  };

  return (
    <AnimatedTouchableOpacity
      activeOpacity={activeOpacity}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale }] }]}
      {...rest}
    />
  );
}
