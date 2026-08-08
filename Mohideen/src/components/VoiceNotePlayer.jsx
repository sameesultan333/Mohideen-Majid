/**
 * Playback for a voice note attached to an announcement.
 *
 * Announcements have carried an `audio_url` since the imam's create screen
 * gained voice recording, but the screens that *read* announcements only ever
 * rendered the title, body and image — so a recorded message was uploaded,
 * stored and returned by the API, and then had no way of being heard. This is
 * the missing playback half.
 *
 * Only one note plays at a time. A list of announcements can hold several
 * players, and without coordination tapping a second one leaves the first
 * still going, so they talk over each other. Each mounted player registers a
 * pause callback and starting one stops the rest.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import Svg, { Path } from "react-native-svg";
import Video from "react-native-video";
import Slider from "@react-native-community/slider";

import AnimatedPressable from "./AnimatedPressable";
import { COLORS as C } from "../config/theme";
import { buildAbsoluteUrl } from "../config/server";

/** Every mounted player's "stop what you're doing" callback. */
const active = new Set();

function stopOthers(self) {
  active.forEach((pause) => {
    if (pause !== self) pause();
  });
}

/** mm:ss — a voice note is never long enough to need hours. */
function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const PlayIcon = ({ color, size = 16 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5 L19 12 L8 19 Z" fill={color} />
  </Svg>
);

const PauseIcon = ({ color, size = 16 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5 L11 5 L11 19 L8 19 Z M14 5 L17 5 L17 19 L14 19 Z" fill={color} />
  </Svg>
);

const SpeakerIcon = ({ color, size = 13 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M4 9 L8 9 L13 5 L13 19 L8 15 L4 15 Z"
      fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"
    />
    <Path
      d="M17 8.5 A5 5 0 0 1 17 15.5"
      fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
    />
  </Svg>
);

export default function VoiceNotePlayer({
  url,
  label,
  accent = C.bgVivid,
  surface = "rgba(11,61,46,0.05)",
  border = "rgba(11,61,46,0.10)",
  textMuted = C.textMuted,
}) {
  const playerRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Mount <Video> only once the note is actually played. A screen showing ten
  // announcements would otherwise open ten media players on load.
  const [armed, setArmed] = useState(false);

  const pause = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    active.add(pause);
    return () => {
      active.delete(pause);
    };
  }, [pause]);

  // Leaving the screen must not leave audio playing underneath it.
  useEffect(() => () => setPlaying(false), []);

  const src = url ? buildAbsoluteUrl(url) : null;
  if (!src) return null;

  const toggle = () => {
    if (failed) {
      // Let a network blip be retried rather than dead-ending the card.
      setFailed(false);
      setArmed(true);
      setLoading(true);
      setPlaying(true);
      return;
    }
    if (playing) {
      setPlaying(false);
      return;
    }
    stopOthers(pause);
    if (!armed) {
      setArmed(true);
      setLoading(true);
    }
    setPlaying(true);
  };

  const onLoad = (meta) => {
    setDuration(meta?.duration || 0);
    setLoading(false);
  };

  const onEnd = () => {
    setPlaying(false);
    setPosition(0);
    playerRef.current?.seek(0);
  };

  const seek = (value) => {
    setPosition(value);
    playerRef.current?.seek(value);
  };

  return (
    <View style={[st.wrap, { backgroundColor: surface, borderColor: border }]}>
      <AnimatedPressable
        onPress={toggle}
        style={[st.btn, { backgroundColor: accent }]}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
      >
        {loading ? (
          <ActivityIndicator size="small" color={C.white} />
        ) : playing ? (
          <PauseIcon color={C.white} />
        ) : (
          <PlayIcon color={C.white} />
        )}
      </AnimatedPressable>

      <View style={st.body}>
        <View style={st.labelRow}>
          <SpeakerIcon color={accent} />
          <Text allowFontScaling={false} style={[st.label, { color: accent }]} numberOfLines={1}>
            {failed ? "Voice message unavailable — tap to retry" : (label || "Voice message")}
          </Text>
        </View>

        <Slider
          style={st.slider}
          minimumValue={0}
          maximumValue={Math.max(duration, 0.1)}
          value={Math.min(position, duration || 0.1)}
          minimumTrackTintColor={accent}
          maximumTrackTintColor={border}
          thumbTintColor={C.gold}
          onSlidingComplete={seek}
          disabled={!duration || failed}
        />

        <Text allowFontScaling={false} style={[st.time, { color: textMuted }]}>
          {clock(position)} / {clock(duration)}
        </Text>
      </View>

      {armed && (
        <Video
          ref={playerRef}
          source={{ uri: src }}
          paused={!playing}
          audioOnly
          ignoreSilentSwitch="ignore"
          playInBackground={false}
          onLoad={onLoad}
          onProgress={(p) => setPosition(p.currentTime)}
          onEnd={onEnd}
          onError={() => {
            setFailed(true);
            setPlaying(false);
            setLoading(false);
          }}
          style={st.hidden}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.2, flexShrink: 1 },
  // Negative margins pull the slider's built-in touch padding back in so the
  // control sits tight under the label instead of floating.
  slider: { width: "100%", height: 26, marginVertical: Platform.OS === "ios" ? 0 : -4 },
  time: { fontSize: 10.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hidden: { width: 0, height: 0 },
});
