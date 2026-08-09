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

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";
import Video from "react-native-video";

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

function VoiceNotePlayer({
  url,
  label,
  accent = C.bgVivid,
  surface = "rgba(11,61,46,0.05)",
  border = "rgba(11,61,46,0.10)",
  textMuted = C.textMuted,
}) {
  const playerRef = useRef(null);
  const trackWidth = useRef(0);

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
      // Leaving the screen must not leave audio playing underneath it.
      setPlaying(false);
    };
  }, [pause]);

  // A fresh object every render makes the native player re-evaluate its source
  // on each progress tick. Keyed on the url so it changes only when the note
  // does.
  const source = useMemo(
    () => (url ? { uri: buildAbsoluteUrl(url) } : null),
    [url],
  );

  const onLoad = useCallback((meta) => {
    setDuration(meta?.duration || 0);
    setLoading(false);
  }, []);

  // The single source of truth for the progress line: the player's own
  // reported position. Never a timer, which would drift away from the audio
  // across pause, seek, buffering and backgrounding.
  const onProgress = useCallback((data) => {
    if (typeof data?.currentTime === "number") setPosition(data.currentTime);
  }, []);

  const onEnd = useCallback(() => {
    setPlaying(false);
    setPosition(0);
    playerRef.current?.seek(0);
  }, []);

  const onError = useCallback(() => {
    setFailed(true);
    setPlaying(false);
    setLoading(false);
  }, []);

  const toggle = useCallback(() => {
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
    setArmed((was) => {
      if (!was) setLoading(true);
      return true;
    });
    // Replaying after it ran to the end starts from the beginning again.
    if (duration > 0 && position >= duration - 0.15) {
      playerRef.current?.seek(0);
      setPosition(0);
    }
    setPlaying(true);
  }, [failed, playing, pause, duration, position]);

  // Tap anywhere on the track to seek there.
  const seekTo = useCallback((evt) => {
    const w = trackWidth.current;
    if (!w || !duration) return;
    const ratio = Math.max(0, Math.min(1, evt.nativeEvent.locationX / w));
    const target = ratio * duration;
    setPosition(target);
    playerRef.current?.seek(target);
  }, [duration]);

  const onTrackLayout = useCallback((e) => {
    trackWidth.current = e.nativeEvent.layout.width;
  }, []);

  if (!source) return null;

  const pct = duration > 0 ? Math.max(0, Math.min(1, position / duration)) * 100 : 0;
  const pctStr = pct + "%";

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
            {failed ? "Voice message unavailable - tap to retry" : (label || "Voice message")}
          </Text>
        </View>

        {/* Plain layout rather than a slider: the fill is a direct function of
            the reported position, so it cannot fall out of step with the audio
            or be held back by a native seekbar's own value handling. */}
        <Pressable
          onPress={seekTo}
          onLayout={onTrackLayout}
          hitSlop={10}
          style={st.track}
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
        >
          <View style={[st.trackBase, { backgroundColor: border }]} />
          <View style={[st.trackFill, { width: pctStr, backgroundColor: accent }]} />
          <View style={[st.thumb, { left: pctStr, backgroundColor: C.gold }]} />
        </Pressable>

        <View style={st.timeRow}>
          <Text allowFontScaling={false} style={[st.time, { color: textMuted }]}>
            {clock(position)}
          </Text>
          <Text allowFontScaling={false} style={[st.time, { color: textMuted }]}>
            {clock(duration)}
          </Text>
        </View>
      </View>

      {armed && (
        <Video
          ref={playerRef}
          source={source}
          paused={!playing}
          audioOnly
          ignoreSilentSwitch="ignore"
          playInBackground={false}
          // Explicit rather than relying on the library default, so the line
          // advances about four times a second on every device.
          progressUpdateInterval={250}
          onLoad={onLoad}
          onProgress={onProgress}
          onEnd={onEnd}
          onError={onError}
          style={st.hidden}
        />
      )}
    </View>
  );
}

// Each card owns its playback state; re-rendering the announcement list must
// not reset or needlessly re-render every player.
export default memo(VoiceNotePlayer);

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
  track: { height: 18, justifyContent: "center", marginTop: 6 },
  trackBase: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2 },
  trackFill: { position: "absolute", left: 0, height: 3, borderRadius: 2 },
  thumb: { position: "absolute", width: 9, height: 9, borderRadius: 5, marginLeft: -4.5 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  time: { fontSize: 10.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hidden: { width: 0, height: 0 },
});
