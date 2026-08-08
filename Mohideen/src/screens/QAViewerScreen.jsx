/**
 * QAViewerScreen — Premium Community Q&A
 * Matches HomeScreen/ProfileScreen palette and styling
 * No emojis · All text from i18n
 */

import React, { useEffect, useState, useRef, useCallback, memo } from "react";
import { View, Text, StyleSheet, FlatList, StatusBar, Platform, ActivityIndicator, RefreshControl, Image, Modal, Dimensions, Animated, SafeAreaView } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getToken, deleteToken } from "../utils/secureStorage";
import Video from "react-native-video";
import Slider from "@react-native-community/slider";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import { apiAxios, buildAbsoluteUrl, getWsUrl } from "../config/server";
import BottomNav from "../components/BottomNav";
import { COLORS as C } from "../config/theme";
import { logger } from "../utils/logger";
import SafeModal from "../components/SafeModal";

const { width: SW, height: SH } = Dimensions.get("window");
const IOS = Platform.OS === "ios";

// ─── Palette (identical to HomeScreen) ─────────────────────────────
const H = {
  bg: "#FBF9F4",
  card: "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold: C.gold,
  goldLight: C.goldLight,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
  error: "#C0473A",
  success: C.bgVivid,
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

// ─── SVG Icons (no emojis) ──────────────────────────────────────────
const BackIcon = ({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ChevronDownIcon = ({ color = H.textMuted, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M7.41 8.59L12 13.17L16.59 8.59L18 10L12 16L6 10Z" fill={color} />
  </Svg>
);

const PlayIcon = ({ color = H.white, size = 28 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5L19 12L8 19Z" fill={color} />
  </Svg>
);

const PauseIcon = ({ color = H.white, size = 28 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 5H10V19H6ZM14 5H18V19H14Z" fill={color} />
  </Svg>
);

const RewindIcon = ({ color = H.textDark, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 12L22 6V18ZM2 12L12 6V18Z" fill={color} opacity={0.6} />
  </Svg>
);

const ForwardIcon = ({ color = H.textDark, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 12L2 6V18ZM22 12L12 6V18Z" fill={color} opacity={0.6} />
  </Svg>
);

const VolumeIcon = ({ color = H.primary, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M3 9V15H7L12 20V4L7 9H3ZM16.5 12C16.5 10.23 15.48 8.71 14 7.97V16.02C15.48 15.29 16.5 13.77 16.5 12ZM14 3.23V5.29C16.89 6.15 19 8.83 19 12C19 15.17 16.89 17.85 14 18.71V20.77C18.01 19.86 21 16.28 21 12C21 7.72 18.01 4.14 14 3.23Z" fill={color} />
  </Svg>
);

const PlayCircleIcon = ({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2A10 10 0 1012 22A10 10 0 1012 2ZM10 16.5L16 12L10 7.5Z" fill={color} />
  </Svg>
);

const CloseIcon = ({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12Z" fill={color} />
  </Svg>
);

const MagnifyIcon = ({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15.5 14H14.71L14.43 13.73A6.5 6.5 0 1013.73 14.43L14.71 14H15.5L20.49 19L19 20.49ZM6.5 9.5A3 3 0 1112.5 9.5A3 3 0 116.5 9.5ZM9 7V9H7V10H9V12H10V10H12V9H10V7Z" fill={color} />
  </Svg>
);

const ForumIcon = ({ color = H.textMuted, size = 64 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM20 16H5.17L4 17.17V4H20V16Z" fill={color} opacity={0.5} />
  </Svg>
);

const MosqueIcon = ({ color = H.gold, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2C10 6 10 12 10 12A4 4 0 102 12V22H22V12A4 4 0 1014 12C14 12 14 6 12 2Z" fill={color} />
  </Svg>
);

// ─── Header Pattern ──────────────────────────────────────────────────
const HeaderPattern = memo(({ w = SW, h = 148 }) => {
  const step = 40;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`);
    }
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => (
        <Path key={i} d={d} fill={H.gold} opacity={0.05} />
      ))}
    </Svg>
  );
});

// ─── Helper: Hijri date ──────────────────────────────────────────────
const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Awwal", "Jumada al-Thani",
  "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah",
];

const gregorianToJDN = (y, m, d) => {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
};

const jdnToHijri = (jdn) => {
  const epoch = 1948440;
  let l = jdn - epoch + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const month = Math.floor((24 * l) / 709);
  const day = l - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day };
};

const getHijriDateString = (date) => {
  try {
    const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const { year, month, day } = jdnToHijri(jdn);
    const monthName = HIJRI_MONTHS[Math.max(0, Math.min(11, month - 1))];
    return `${day} ${monthName} ${year} AH`;
  } catch {
    return "Hijri unavailable";
  }
};

// ─── Compact Header ──────────────────────────────────────────────────
const CompactHeader = ({ onBack, title, hijriDate, gregorianDate, connectionStatus }) => {
  const statusColor = connectionStatus === "connected" ? H.success : connectionStatus === "connecting" ? H.gold : H.error;
  const statusText = connectionStatus === "connected" ? "Live" : connectionStatus === "connecting" ? "Connecting..." : "Offline";

  return (
    <View style={hs.wrap}>
      <Svg width={SW} height={148} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset={0} stopColor={H.headerDeep} />
            <Stop offset={1} stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />

      <View style={hs.row}>
        <AnimatedPressable onPress={onBack} style={hs.backBtn}>
          <BackIcon />
        </AnimatedPressable>
        <View style={hs.titleContainer}>
          <Text style={hs.title}>{title}</Text>
        </View>
        <View style={hs.iconContainer}>
          <MosqueIcon color={H.goldLight} size={24} />
        </View>
      </View>

      <View style={hs.dateRow}>
        <Text style={hs.dateTxt}>{gregorianDate}</Text>
        <View style={hs.dateDot} />
        <Text style={hs.dateTxt}>{hijriDate}</Text>
        <View style={hs.statusIndicator}>
          <View style={[hs.statusDot, { backgroundColor: statusColor }]} />
          <Text style={hs.statusText}>{statusText}</Text>
        </View>
      </View>
    </View>
  );
};

// ─── Audio Player Component ──────────────────────────────────────────
const AudioPlayer = memo(({ audioUrl, onClose }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        setIsPlaying(false);
      }
    };
  }, []);

  const onLoad = useCallback((meta) => {
    setDuration(meta.duration || 0);
    setIsLoading(false);
    setIsPlaying(true);
  }, []);

  const onProgress = useCallback((progress) => {
    if (!isSeeking) {
      setCurrentTime(progress.currentTime);
    }
  }, [isSeeking]);

  const onEnd = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.seek(0);
    }
  }, []);

  const onError = useCallback((err) => {
    logger.error("Audio error:", err);
    setError("Failed to load audio");
    setIsLoading(false);
  }, []);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const seek = useCallback((value) => {
    if (videoRef.current) {
      videoRef.current.seek(value);
      setCurrentTime(value);
    }
  }, []);

  const seekBackward = useCallback(() => {
    const newTime = Math.max(0, currentTime - 10);
    seek(newTime);
  }, [currentTime, seek]);

  const seekForward = useCallback(() => {
    const newTime = Math.min(duration, currentTime + 10);
    seek(newTime);
  }, [currentTime, duration, seek]);

  const handleSlidingStart = useCallback(() => setIsSeeking(true), []);
  const handleSlidingComplete = useCallback((value) => {
    seek(value);
    setIsSeeking(false);
  }, [seek]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (error) {
    return (
      <View style={styles.audioErrorContainer}>
        <Text style={styles.audioErrorText}>{error}</Text>
        <AnimatedPressable style={styles.retryButtonSmall} onPress={onClose}>
          <Text style={styles.retryButtonTextSmall}>Close</Text>
        </AnimatedPressable>
      </View>
    );
  }

  return (
    <View style={styles.audioPlayerContainer}>
      <Video
        ref={videoRef}
        source={{ uri: audioUrl }}
        audioOnly
        paused={!isPlaying}
        onLoad={onLoad}
        onProgress={onProgress}
        onEnd={onEnd}
        onError={onError}
        playInBackground={false}
        ignoreSilentSwitch="ignore"
        progressUpdateInterval={250}
        style={styles.hiddenVideo}
      />

      <View style={styles.progressSection}>
        <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        <View style={styles.sliderContainer}>
          {isLoading ? (
            <ActivityIndicator size="small" color={H.gold} />
          ) : (
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={duration || 1}
              value={currentTime}
              onSlidingStart={handleSlidingStart}
              onSlidingComplete={handleSlidingComplete}
              minimumTrackTintColor={H.gold}
              maximumTrackTintColor={H.cardBorder}
              thumbTintColor={H.gold}
            />
          )}
        </View>
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>

      <View style={styles.controlsSection}>
        <AnimatedPressable style={styles.controlButton} onPress={seekBackward} disabled={isLoading}>
          <RewindIcon color={isLoading ? H.textMuted : H.textDark} />
        </AnimatedPressable>
        <AnimatedPressable style={styles.playButton} onPress={togglePlayPause} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color={H.white} />
          ) : isPlaying ? (
            <PauseIcon color={H.white} size={28} />
          ) : (
            <PlayIcon color={H.white} size={28} />
          )}
        </AnimatedPressable>
        <AnimatedPressable style={styles.controlButton} onPress={seekForward} disabled={isLoading}>
          <ForwardIcon color={isLoading ? H.textMuted : H.textDark} />
        </AnimatedPressable>
      </View>
    </View>
  );
});

// ─── Image Viewer Modal ──────────────────────────────────────────────
const ImageViewerModal = memo(({ visible, imageUrl, onClose }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
      }).start();
    } else {
      scaleAnim.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <SafeModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.imageModalOverlay}>
        <AnimatedPressable style={styles.imageModalBackground} activeOpacity={1} onPress={onClose}>
          <Animated.View style={[styles.imageModalContent, { transform: [{ scale: scaleAnim }] }]}>
            {isLoading && (
              <View style={styles.imageLoadingContainer}>
                <ActivityIndicator size="large" color={H.gold} />
              </View>
            )}
            <Image
              source={{ uri: imageUrl }}
              style={styles.fullImage}
              resizeMode="contain"
              onLoadStart={() => setIsLoading(true)}
              onLoadEnd={() => setIsLoading(false)}
            />
            <AnimatedPressable style={styles.closeButton} onPress={onClose}>
              <CloseIcon color={H.white} size={24} />
            </AnimatedPressable>
          </Animated.View>
        </AnimatedPressable>
      </View>
    </SafeModal>
  );
});

// ─── QA Card Component ──────────────────────────────────────────────
const QACard = memo(({ item, isExpanded, onToggle, onImagePress, playingAudioId, onAudioToggle }) => {
  const { t } = useTranslation();
  const expandAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(expandAnim, {
        toValue: isExpanded ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(rotateAnim, {
        toValue: isExpanded ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isExpanded]);

  const imageUrl = buildAbsoluteUrl(item.answer_image_url);
  const voiceUrl = buildAbsoluteUrl(item.answer_voice_url);
  const isPlaying = playingAudioId === item.id;
  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <AnimatedPressable activeOpacity={0.95} style={styles.card} onPress={onToggle}>
      <View style={styles.cardHeader}>
        <View style={styles.questionIconContainer}>
          <Text style={styles.questionIcon}>Q</Text>
        </View>
        <View style={styles.questionContent}>
          <Text style={styles.questionText} numberOfLines={isExpanded ? undefined : 2}>
            {item.question_text}
          </Text>
          <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
          <ChevronDownIcon color={H.textMuted} size={24} />
        </Animated.View>
      </View>

      <Animated.View
        style={[
          styles.answerContainer,
          {
            maxHeight: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1000],
            }),
            opacity: expandAnim,
          },
        ]}
      >
        <View style={styles.answerDivider} />
        <View style={styles.answerContent}>
          <View style={styles.answerBadge}>
            <Text style={styles.answerBadgeText}>{t("qaViewer.answerBadge")}</Text>
          </View>

          {item.answer_text && (
            <Text style={styles.answerText}>{item.answer_text}</Text>
          )}

          {imageUrl && (
            <AnimatedPressable style={styles.imageContainer} onPress={() => onImagePress(imageUrl)} activeOpacity={0.9}>
              <Image source={{ uri: imageUrl }} style={styles.answerImage} resizeMode="cover" />
              <View style={styles.imageOverlay}>
                <MagnifyIcon color={H.white} size={24} />
                <Text style={styles.imageOverlayText}>{t("qaViewer.tapToView")}</Text>
              </View>
            </AnimatedPressable>
          )}

          {voiceUrl && (
            <View style={styles.audioSection}>
              <View style={styles.audioHeader}>
                <VolumeIcon color={H.primary} size={18} />
                <Text style={styles.audioHeaderText}>{t("qaViewer.audioAnswer")}</Text>
              </View>
              {isPlaying ? (
                <AudioPlayer audioUrl={voiceUrl} onClose={() => onAudioToggle(null)} />
              ) : (
                <AnimatedPressable style={styles.playAudioButton} onPress={() => onAudioToggle(item.id)}>
                  <PlayCircleIcon color={H.white} size={20} />
                  <Text style={styles.playAudioText}>{t("qaViewer.listen")}</Text>
                </AnimatedPressable>
              )}
            </View>
          )}
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
});

// ─── Main Component ──────────────────────────────────────────────────
export default function QAViewerScreen({ navigation, route }) {
  const { t } = useTranslation();
  const [qas, setQas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [currentTime, setCurrentTime] = useState(new Date());

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const flatListRef = useRef(null);

  // ─── WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    const connectWebSocket = () => {
      (async () => {
        try {
          if (wsRef.current?.readyState === WebSocket.OPEN) return;
          setConnectionStatus("connecting");
          const wsUrl = await getWsUrl("/ws/questions");
          wsRef.current = new WebSocket(wsUrl);

          wsRef.current.onopen = () => {
            logger.log("✅ WS Connected");
            setConnectionStatus("connected");
            setError(null);
          };

          wsRef.current.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "NEW_QA") {
                const newQA = msg.data;
                setQas((prev) => {
                  if (prev.find((q) => q.id === newQA.id)) return prev;
                  return [newQA, ...prev];
                });
                if (flatListRef.current) {
                  flatListRef.current.scrollToOffset({ offset: 0, animated: true });
                }
              }
            } catch (err) {
              logger.error("WS Parse Error:", err);
            }
          };

          wsRef.current.onerror = (err) => {
            logger.log("⚠️ WS warning:", err);
          };

          wsRef.current.onclose = () => {
            logger.log("⚠️ WS Disconnected");
            setConnectionStatus("disconnected");
            reconnectTimeoutRef.current = setTimeout(() => {
              logger.log("🔄 Reconnecting...");
              connectWebSocket();
            }, 3000);
          };
        } catch (err) {
          logger.error("WS Connection Error:", err);
          setConnectionStatus("error");
        }
      })();
    };

    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ─── Clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ─── Fetch Data ────────────────────────────────────────────────────
  const fetchQAs = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      setError(null);

      const token = await getToken();
      if (!token) throw new Error("No token");

      const res = await apiAxios({
        method: "get",
        url: "/questions/",
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });

      setQas(res.data || []);
    } catch (err) {
      logger.log("Fetch Error:", err);
      if (err?.response?.status === 401) {
        await deleteToken();
        navigation?.replace?.("Login");
        setError("Session expired. Please login again.");
        return;
      }
      setError(err?.message || "Failed to load questions");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchQAs();
  }, []);

  // ─── Mark every currently-loaded answered question as read as soon as
  // this screen is opened, so the Deen tab "answered" badge clears
  // immediately instead of never (there was previously no write path for
  // "read_questions" at all — only deenUnread.js/DeenScreen read it).
  useEffect(() => {
    if (qas.length === 0) return;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem("read_questions");
        const existing = saved ? JSON.parse(saved) : [];
        const ids = qas.map((q) => q.id);
        const merged = Array.from(new Set([...existing, ...ids]));
        if (merged.length !== existing.length) {
          await AsyncStorage.setItem("read_questions", JSON.stringify(merged));
        }
      } catch {}
    })();
  }, [qas]);

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleToggleExpand = useCallback((id) => {
    setExpandedId((prev) => (prev === id ? null : id));
    if (expandedId !== id) setPlayingAudioId(null);
  }, [expandedId]);

  const handleAudioToggle = useCallback((id) => {
    setPlayingAudioId((prev) => (prev === id ? null : id));
  }, []);

  const handleImagePress = useCallback((url) => setImagePreview(url), []);
  const handleCloseImage = useCallback(() => setImagePreview(null), []);
  const handleRetry = useCallback(() => fetchQAs(true), [fetchQAs]);

  // ─── Rendering ──────────────────────────────────────────────────────
  const renderEmpty = useCallback(() => (
    <View style={styles.emptyContainer}>
      <ForumIcon color={H.textMuted} size={64} />
      <Text style={styles.emptyTitle}>{t("qaViewer.emptyTitle")}</Text>
      <Text style={styles.emptySubtitle}>{t("qaViewer.emptySubtitle")}</Text>
    </View>
  ), [t]);

  const renderError = useCallback(() => (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>{t("qaViewer.errorTitle")}</Text>
      <Text style={styles.errorSubtitle}>{error}</Text>
      <AnimatedPressable style={styles.retryButton} onPress={handleRetry}>
        <Text style={styles.retryButtonText}>{t("qaViewer.retry")}</Text>
      </AnimatedPressable>
    </View>
  ), [error, handleRetry, t]);

  const renderItem = useCallback(({ item }) => (
    <QACard
      item={item}
      isExpanded={expandedId === item.id}
      onToggle={() => handleToggleExpand(item.id)}
      onImagePress={handleImagePress}
      playingAudioId={playingAudioId}
      onAudioToggle={handleAudioToggle}
    />
  ), [expandedId, playingAudioId, handleToggleExpand, handleImagePress, handleAudioToggle]);

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <SafeAreaView style={styles.root}>

      <CompactHeader
        onBack={() => navigation.goBack()}
        title={t("qaViewer.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
        connectionStatus={connectionStatus}
      />

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={H.gold} />
          <Text style={styles.loadingText}>{t("qaViewer.loading")}</Text>
        </View>
      ) : error ? (
        renderError()
      ) : (
        <FlatList
          ref={flatListRef}
          data={qas}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, qas.length === 0 && styles.emptyListContent]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchQAs(true)} tintColor={H.gold} colors={[H.gold]} />
          }
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === "android"}
        />
      )}

      <ImageViewerModal visible={!!imagePreview} imageUrl={imagePreview} onClose={handleCloseImage} />

      <BottomNav navigation={navigation} currentRoute="Deen" />
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  // Header styles are in `hs` below.

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 16, color: H.textMuted, fontSize: 14, fontWeight: "500" },

  listContent: { padding: 16, paddingBottom: 100 },
  emptyListContent: { flex: 1, justifyContent: "center" },

  // Card
  card: {
    backgroundColor: H.card,
    borderRadius: 22,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    overflow: "hidden",
    ...shadow(4, 0.06),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  questionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: H.gold,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  questionIcon: {
    color: H.white,
    fontSize: 16,
    fontWeight: "800",
  },
  questionContent: {
    flex: 1,
    marginRight: 8,
  },
  questionText: {
    fontSize: 15,
    fontWeight: "700",
    color: H.textDark,
    lineHeight: 22,
  },
  dateText: {
    fontSize: 12,
    color: H.textMuted,
    marginTop: 4,
  },

  // Answer section
  answerContainer: { overflow: "hidden" },
  answerDivider: { height: 1, backgroundColor: H.cardBorder, marginHorizontal: 16 },
  answerContent: { padding: 16, paddingTop: 12 },
  answerBadge: {
    alignSelf: "flex-start",
    backgroundColor: H.headerDeep,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  answerBadgeText: {
    color: H.white,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  answerText: {
    fontSize: 14,
    color: H.textDark,
    lineHeight: 22,
    marginBottom: 16,
  },

  // Image
  imageContainer: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
    position: "relative",
  },
  answerImage: {
    width: "100%",
    height: 200,
    backgroundColor: H.cardBorder,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageOverlayText: {
    color: H.white,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
  },

  // Audio
  audioSection: {
    backgroundColor: H.bg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
  },
  audioHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  audioHeaderText: {
    fontSize: 13,
    fontWeight: "700",
    color: H.headerDeep,
    marginLeft: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  playAudioButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: H.headerDeep,
    paddingVertical: 14,
    borderRadius: 12,
  },
  playAudioText: {
    color: H.white,
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 8,
  },

  // Audio Player
  audioPlayerContainer: {
    backgroundColor: H.card,
    borderRadius: 12,
    padding: 12,
  },
  hiddenVideo: { width: 0, height: 0 },
  progressSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  timeText: {
    fontSize: 12,
    fontWeight: "600",
    color: H.textMuted,
    width: 45,
    textAlign: "center",
  },
  sliderContainer: { flex: 1, marginHorizontal: 8 },
  slider: { width: "100%", height: 40 },
  controlsSection: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: H.bg,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 8,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: H.headerDeep,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 12,
    ...shadow(4, 0.15),
  },
  audioErrorContainer: { padding: 20, alignItems: "center" },
  audioErrorText: { color: H.error, fontSize: 14, marginBottom: 12 },
  retryButtonSmall: { backgroundColor: H.headerDeep, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryButtonTextSmall: { color: H.white, fontWeight: "700", fontSize: 12 },

  // Image Modal
  imageModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center" },
  imageModalBackground: { flex: 1, width: "100%", justifyContent: "center", alignItems: "center" },
  imageModalContent: { width: SW * 0.9, height: SH * 0.6, justifyContent: "center", alignItems: "center" },
  fullImage: { width: "100%", height: "100%", borderRadius: 12 },
  imageLoadingContainer: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", zIndex: 1 },
  closeButton: {
    position: "absolute",
    top: -40,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Empty / Error
  emptyContainer: { alignItems: "center", paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: H.textDark, marginTop: 16, fontFamily: "Georgia" },
  emptySubtitle: { fontSize: 14, color: H.textMuted, textAlign: "center", marginTop: 8, lineHeight: 20 },

  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  errorTitle: { fontSize: 24, fontWeight: "700", color: H.textDark, marginTop: 16, fontFamily: "Georgia" },
  errorSubtitle: { fontSize: 14, color: H.textMuted, textAlign: "center", marginTop: 8, marginBottom: 24, lineHeight: 20 },

  retryButton: { backgroundColor: H.headerDeep, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryButtonText: { color: H.white, fontSize: 14, fontWeight: "700" },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 136,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingTop: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  titleContainer: { flex: 1, marginLeft: 12 },
  title: { color: H.white, fontSize: 18, fontWeight: "700", fontFamily: "Georgia" },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginRight: 8,
    flexWrap: "wrap",
  },
  dateTxt: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10.5,
    fontWeight: "600",
    marginRight: 8,
  },
  dateDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: H.goldLight,
    marginRight: 8,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "600",
  },
});