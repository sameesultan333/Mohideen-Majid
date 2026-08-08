/**
 * HadithDetailScreen — Premium Hadith with Comments Overlay
 * Full audio player · Bottom-sheet comments · No text errors
 */

import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TextInput, StatusBar, Platform, KeyboardAvoidingView, Keyboard, RefreshControl, SafeAreaView, Dimensions, Modal, Animated, ScrollView, Image } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getToken } from "../utils/secureStorage";
import Video from "react-native-video";
import Slider from "@react-native-community/slider";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import { apiAxios, buildAbsoluteUrl } from "../config/server";
import { COLORS as C } from "../config/theme";

const { width: SW, height: SH } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { useTopInset } from "../hooks/useSafeArea";

// ─── Palette ──────────────────────────────────────────────────────────
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

// ─── SVG Icons ──────────────────────────────────────────────────────────
const BackIcon = ({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const SendIcon = ({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M2 21L23 12L2 3V10L17 12L2 14V21Z" fill={color} />
  </Svg>
);

const PlayIcon = ({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5L19 12L8 19Z" fill={color} />
  </Svg>
);

const PauseIcon = ({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 5H10V19H6ZM14 5H18V19H14Z" fill={color} />
  </Svg>
);

const StopIcon = ({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="5" y="5" width="14" height="14" fill={color} />
  </Svg>
);

const RewindIcon = ({ color = H.textMuted, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 12L22 6V18Z" fill={color} />
    <Path d="M2 12L12 6V18Z" fill={color} />
  </Svg>
);

const ForwardIcon = ({ color = H.textMuted, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 12L2 6V18Z" fill={color} />
    <Path d="M22 12L12 6V18Z" fill={color} />
  </Svg>
);

const CommentBubbleIcon = ({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill={color} />
  </Svg>
);

const CloseIcon = ({ color = H.textMuted, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12Z" fill={color} />
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

// ─── Hijri Helper ──────────────────────────────────────────────────────
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
const CompactHeader = ({ onBack, title, hijriDate, gregorianDate }) => {
  const topInset = useTopInset();
  const safeTitle = title ? String(title) : '';
  const safeGregorian = gregorianDate ? String(gregorianDate) : '';
  const safeHijri = hijriDate ? String(hijriDate) : '';

  return (
    <View style={[hs.wrap, { paddingTop: topInset }]}>
      <Svg width={SW} height={148 + topInset} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={H.headerDeep} />
            <Stop offset="100%" stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148 + topInset} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />

      <View style={hs.row}>
        <AnimatedPressable onPress={onBack} style={hs.backBtn}>
          <BackIcon />
        </AnimatedPressable>
        <View style={hs.titleContainer}>
          <Text style={hs.title}>{safeTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View style={hs.dateRow}>
        <Text style={hs.dateTxt}>{safeGregorian}</Text>
        <View style={hs.dateDot} />
        <Text style={hs.dateTxt}>{safeHijri}</Text>
      </View>
    </View>
  );
};

// ─── Full Audio Player ──────────────────────────────────────────────────
const AudioPlayer = memo(({ audioUrl }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rate, setRate] = useState(1.0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  useEffect(() => {
    return () => {
      if (videoRef.current) videoRef.current.pause();
    };
  }, []);

  const onLoad = useCallback((meta) => {
    setDuration(meta.duration || 0);
    setIsLoading(false);
  }, []);

  const onProgress = useCallback((progress) => {
    if (!isSeeking) setCurrentTime(progress.currentTime);
  }, [isSeeking]);

  const onEnd = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    videoRef.current?.seek(0);
  }, []);

  const onError = useCallback(() => {
    setError("Failed to load audio");
    setIsLoading(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (!isPlaying && currentTime >= duration - 0.5) {
      videoRef.current?.seek(0);
      setCurrentTime(0);
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying, currentTime, duration]);

  const stopAudio = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    videoRef.current?.seek(0);
  }, []);

  const changeSpeed = useCallback(() => {
    setRate((prev) => (prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1));
  }, []);

  const seek = useCallback((value) => {
    if (videoRef.current) {
      videoRef.current.seek(value);
      setCurrentTime(value);
    }
  }, []);

  const rewind10 = useCallback(() => {
    seek(Math.max(0, currentTime - 10));
  }, [currentTime, seek]);

  const forward10 = useCallback(() => {
    seek(Math.min(duration, currentTime + 10));
  }, [currentTime, duration, seek]);

  const onSlidingStart = useCallback(() => setIsSeeking(true), []);
  const onSlidingComplete = useCallback((value) => {
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
        rate={rate}
        onLoad={onLoad}
        onProgress={onProgress}
        onEnd={onEnd}
        onError={onError}
        playInBackground={false}
        ignoreSilentSwitch="ignore"
        style={styles.hiddenVideo}
      />

      <View style={styles.audioProgressRow}>
        <Text style={styles.audioTime}>{formatTime(currentTime)}</Text>
        <Slider
          style={styles.audioSlider}
          minimumValue={0}
          maximumValue={duration || 1}
          value={currentTime}
          onSlidingStart={onSlidingStart}
          onSlidingComplete={onSlidingComplete}
          minimumTrackTintColor={H.gold}
          maximumTrackTintColor={H.cardBorder}
          thumbTintColor={H.gold}
        />
        <Text style={styles.audioTime}>{formatTime(duration)}</Text>
      </View>

      <View style={styles.audioControls}>
        <AnimatedPressable onPress={rewind10} style={styles.audioControlBtn}>
          <RewindIcon color={H.textMuted} size={18} />
        </AnimatedPressable>
        <AnimatedPressable style={styles.audioPlayBtn} onPress={togglePlay} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color={H.white} />
          ) : isPlaying ? (
            <PauseIcon color={H.white} size={22} />
          ) : (
            <PlayIcon color={H.white} size={22} />
          )}
        </AnimatedPressable>
        <AnimatedPressable onPress={stopAudio} style={styles.audioControlBtn}>
          <StopIcon color={H.textMuted} size={18} />
        </AnimatedPressable>
        <AnimatedPressable onPress={changeSpeed} style={styles.audioSpeedBtn}>
          <Text style={styles.audioSpeedText}>{rate}x</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={forward10} style={styles.audioControlBtn}>
          <ForwardIcon color={H.textMuted} size={18} />
        </AnimatedPressable>
      </View>
    </View>
  );
});

// ─── Comments Overlay ────────────────────────────────────────────────────
const CommentsOverlay = ({
  visible,
  onClose,
  replies,
  loading,
  refreshing,
  onRefresh,
  replyText,
  setReplyText,
  submitting,
  onSendReply,
  replyTo,
  setReplyTo,
  onReplyPress,
  anonNumberByUser,
  expandedIds,
  onToggleExpanded,
  t,
}) => {
  const slideAnim = useRef(new Animated.Value(SH)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 10 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 300, useNativeDriver: true }).start();
    }
  }, [visible]);

  const renderReply = ({ item, index }) => {
    const isImam = item.user_role === "imam";
    const anonNum = anonNumberByUser?.get(item.user_id) || 1;
    const author = isImam ? t("hadithDetail.imam") : t("hadithDetail.anonymousNumbered", { number: anonNum });
    const avatarText = isImam ? "I" : String(anonNum);
    const timeText = item.created_at ? String(new Date(item.created_at).toLocaleDateString()) : "";
    const replyText = item.text ? String(item.text) : "";
    const isChild = item.parent_reply_id !== null && item.parent_reply_id !== undefined;
    const hasChildren = item.childCount > 0;
    const isExpanded = expandedIds?.has(item.id);

    return (
      <View style={[styles.commentItem, isChild && styles.commentChild]}>
        <View style={styles.commentAvatar}>
          <Text style={styles.commentAvatarText}>{avatarText}</Text>
        </View>
        <View style={styles.commentContent}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentAuthor}>{author}</Text>
            {isImam && (
              <View style={styles.imamBadgeSmall}>
                <Text style={styles.imamBadgeSmallText}>{t("hadithDetail.imamBadge")}</Text>
              </View>
            )}
            <Text style={styles.commentTime}>{timeText}</Text>
          </View>
          <Text style={styles.commentText}>{replyText}</Text>
          <AnimatedPressable onPress={() => onReplyPress(item)} activeOpacity={0.6}>
            <Text style={styles.commentReplyAction}>{t("hadithDetail.reply")}</Text>
          </AnimatedPressable>
          {hasChildren && (
            <AnimatedPressable
              style={styles.viewRepliesBtn}
              activeOpacity={0.6}
              onPress={() => onToggleExpanded(item.id)}
            >
              <Text style={styles.viewRepliesText}>
                {isExpanded
                  ? t("hadithDetail.hideReplies")
                  : t("hadithDetail.viewReplies", { count: item.childCount })}
              </Text>
            </AnimatedPressable>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <AnimatedPressable style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.overlayContainer, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.overlayHeader}>
          <View style={styles.overlayHandle} />
          <View style={styles.overlayTitleRow}>
            <Text style={styles.overlayTitle}>{t("hadithDetail.comments")}</Text>
            <AnimatedPressable onPress={onClose}>
              <CloseIcon color={H.textMuted} size={24} />
            </AnimatedPressable>
          </View>
          <Text style={styles.overlaySubtitle}>
            {replies.length} {t("hadithDetail.repliesCount")}
          </Text>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.overlayFlex}
          keyboardVerticalOffset={Platform.OS === "ios" ? 120 : 0}
        >
          {loading && !refreshing ? (
            <View style={styles.overlayCenter}>
              <ActivityIndicator size="large" color={H.gold} />
              <Text style={styles.overlayLoadingText}>{t("hadithDetail.loading")}</Text>
            </View>
          ) : (
            <FlatList
              data={replies}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderReply}
              contentContainerStyle={[styles.commentsList, replies.length === 0 && styles.emptyCommentsList]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} />}
              ListEmptyComponent={
                <View style={styles.emptyComments}>
                  <Text style={styles.emptyCommentsTitle}>{t("hadithDetail.noReplies")}</Text>
                  <Text style={styles.emptyCommentsSub}>{t("hadithDetail.noRepliesSub")}</Text>
                </View>
              }
              showsVerticalScrollIndicator={false}
            />
          )}

          <View style={styles.overlayInputContainer}>
            {replyTo && (
              <View style={styles.replyToIndicator}>
                <Text style={styles.replyToText}>
                  {t("hadithDetail.replyingTo")} {replyTo.author}
                </Text>
                <AnimatedPressable onPress={() => setReplyTo(null)}>
                  <Text style={styles.replyToCancel}>{t("hadithDetail.cancel")}</Text>
                </AnimatedPressable>
              </View>
            )}
            <View style={styles.inputWrapper}>
              <TextInput
                placeholder={
                  replyTo
                    ? `${t("hadithDetail.replyTo")} ${replyTo.author}...`
                    : t("hadithDetail.replyPlaceholder")
                }
                placeholderTextColor={H.textMuted}
                value={replyText}
                onChangeText={setReplyText}
                style={styles.overlayInput}
                multiline
                maxLength={500}
              />
              <AnimatedPressable
                style={[styles.sendBtn, (!replyText.trim() || submitting) && styles.sendBtnDisabled]}
                onPress={onSendReply}
                disabled={!replyText.trim() || submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={H.white} />
                ) : (
                  <SendIcon color={H.white} size={18} />
                )}
              </AnimatedPressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
};

// ─── Main Component ──────────────────────────────────────────────────
export default function HadithDetailScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { hadithId, hadith } = route.params || {};
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [error, setError] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [commentsVisible, setCommentsVisible] = useState(false);

  // Mark hadith as read on open
  useEffect(() => {
    if (hadithId) {
      AsyncStorage.getItem("read_hadiths").then((saved) => {
        const readIds = saved ? JSON.parse(saved) : [];
        if (!readIds.includes(hadithId)) {
          readIds.push(hadithId);
          AsyncStorage.setItem("read_hadiths", JSON.stringify(readIds)).catch(() => {});
        }
      });
    }
  }, [hadithId]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  // ─── Load replies ──────────────────────────────────────────────────
  const loadReplies = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const cacheKey = `hadith_replies_${hadithId}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached && !isRefresh) {
        setReplies(JSON.parse(cached));
      }

      const res = await apiAxios({
        method: "get",
        url: `/hadith/${hadithId}/replies`,
        timeout: 10000,
      });

      const freshReplies = res.data || [];
      setReplies(freshReplies);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(freshReplies));
    } catch (err) {
      setError(t("hadithDetail.loadError"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hadithId, t]);

  useEffect(() => {
    if (hadithId) loadReplies();
  }, [hadithId]);

  // ─── Post reply ──────────────────────────────────────────────────
  const postReply = useCallback(async () => {
    if (!replyText.trim()) return;
    try {
      setSubmitting(true);
      const token = await getToken();
      await apiAxios({
        method: "post",
        url: `/hadith/${hadithId}/reply`,
        data: {
          text: replyText.trim(),
          parent_reply_id: replyTo?.id || null,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      setReplyText("");
      setReplyTo(null);
      Keyboard.dismiss();
      await loadReplies(true);
    } catch (err) {
      setError(t("hadithDetail.postError"));
    } finally {
      setSubmitting(false);
    }
  }, [replyText, hadithId, replyTo, loadReplies, t]);

  const onRefresh = useCallback(() => loadReplies(true), [loadReplies]);

  const handleReplyPress = useCallback((reply) => {
    const author = reply.user_role === "imam"
      ? t("hadithDetail.imam")
      : t("hadithDetail.anonymousNumbered", { number: anonNumberByUser.get(reply.user_id) || 1 });
    setReplyTo({ id: reply.id, author });
    setReplyText(`@${author} `);
    // We'll focus in the overlay input via ref – we'll use a ref later if needed.
  }, [anonNumberByUser, t]);

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // ─── Flatten replies for overlay (show all replies, with indent) ──
  const buildReplyTree = (flatReplies) => {
    const map = {};
    const roots = [];
    flatReplies.forEach((r) => {
      map[r.id] = { ...r, children: [] };
    });
    flatReplies.forEach((r) => {
      if (r.parent_reply_id && map[r.parent_reply_id]) {
        map[r.parent_reply_id].children.push(map[r.id]);
      } else {
        roots.push(map[r.id]);
      }
    });
    // Sort roots by created_at (oldest first)
    roots.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    roots.forEach((root) => {
      root.children.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    });
    return roots;
  };

  // Instagram-style: a reply's children stay collapsed behind a
  // "View N replies" toggle until the user taps it, instead of always
  // dumping the whole thread flat on screen.
  const [expandedIds, setExpandedIds] = useState(new Set());
  const toggleExpanded = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const flattenTree = (tree, depth = 0) => {
    let flat = [];
    tree.forEach((item) => {
      const childCount = item.children.length;
      flat.push({ ...item, depth, isChild: depth > 0, childCount });
      if (childCount > 0 && (depth > 0 || expandedIds.has(item.id))) {
        flat = flat.concat(flattenTree(item.children, depth + 1));
      }
    });
    return flat;
  };

  const replyTree = buildReplyTree(replies);
  const flatReplies = flattenTree(replyTree);

  // Stable per-thread numbering: same person always gets the same
  // "Anonymous N" within this hadith's discussion, in order of first
  // appearance (backend already returns replies oldest-first).
  const anonNumberByUser = useMemo(() => {
    const map = new Map();
    let counter = 0;
    for (const r of replies) {
      if (r.user_role === "imam") continue;
      if (!map.has(r.user_id)) {
        counter += 1;
        map.set(r.user_id, counter);
      }
    }
    return map;
  }, [replies]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <CompactHeader
        onBack={() => navigation.goBack()}
        title={t("hadithDetail.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hadith Preview with Audio */}
          {hadith && (
            <View style={styles.hadithPreview}>
              <Text style={styles.hadithTranslation}>
                {hadith.translation ? String(hadith.translation) : ""}
              </Text>
              {hadith.arabic && (
                <Text style={styles.hadithArabic}>{String(hadith.arabic)}</Text>
              )}
              {hadith.source && (
                <Text style={styles.hadithSource}>— {String(hadith.source)}</Text>
              )}
              {hadith.image_url && (
                <Image
                  source={{ uri: buildAbsoluteUrl(hadith.image_url) }}
                  style={{ width: "100%", height: 200, borderRadius: 12, marginTop: 14 }}
                  resizeMode="cover"
                />
              )}
              {hadith.voice_url && (
                <AudioPlayer audioUrl={buildAbsoluteUrl(hadith.voice_url)} />
              )}
            </View>
          )}

          {/* Comments Button */}
          <AnimatedPressable
            style={styles.commentsButton}
            onPress={() => setCommentsVisible(true)}
            activeOpacity={0.8}
          >
            <CommentBubbleIcon color={H.white} size={20} />
            <Text style={styles.commentsButtonText}>
              {t("hadithDetail.viewComments")} ({replies.length})
            </Text>
          </AnimatedPressable>
          <View style={{ height: 20 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Comments Overlay */}
      <CommentsOverlay
        visible={commentsVisible}
        onClose={() => setCommentsVisible(false)}
        replies={flatReplies}
        loading={loading}
        refreshing={refreshing}
        onRefresh={onRefresh}
        replyText={replyText}
        setReplyText={setReplyText}
        submitting={submitting}
        onSendReply={postReply}
        replyTo={replyTo}
        setReplyTo={setReplyTo}
        onReplyPress={handleReplyPress}
        anonNumberByUser={anonNumberByUser}
        expandedIds={expandedIds}
        onToggleExpanded={toggleExpanded}
        t={t}
      />
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },
  flex: { flex: 1 },
  scrollContent: {
    paddingVertical: 16,
    paddingBottom: 40,
  },

  hadithPreview: {
    backgroundColor: H.card,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: H.cardBorder,
    ...shadow(4, 0.06),
  },
  hadithTranslation: {
    fontSize: 16,
    fontWeight: "600",
    color: H.textDark,
    lineHeight: 24,
  },
  hadithArabic: {
    fontSize: 18,
    textAlign: "right",
    color: H.headerDeep,
    fontWeight: "700",
    marginTop: 8,
    fontFamily: "Georgia",
  },
  hadithSource: {
    fontSize: 12,
    color: H.textMuted,
    marginTop: 6,
    fontStyle: "italic",
  },

  // Audio Player
  audioPlayerContainer: {
    marginTop: 12,
    padding: 10,
    backgroundColor: H.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
  },
  hiddenVideo: { width: 0, height: 0 },
  audioProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  audioTime: {
    fontSize: 10,
    fontWeight: "600",
    color: H.textMuted,
    width: 40,
    textAlign: "center",
  },
  audioSlider: { flex: 1, height: 30, marginHorizontal: 6 },
  audioControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  audioControlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: H.card,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: H.cardBorder,
  },
  audioPlayBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: H.headerDeep,
    justifyContent: "center",
    alignItems: "center",
    ...shadow(4, 0.12),
  },
  audioSpeedBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: H.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: H.cardBorder,
  },
  audioSpeedText: {
    fontSize: 12,
    fontWeight: "700",
    color: H.goldDeep,
  },
  audioErrorContainer: {
    padding: 8,
    alignItems: "center",
  },
  audioErrorText: {
    color: H.error,
    fontSize: 12,
  },

  // Comments Button
  commentsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: H.headerDeep,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 16,
    gap: 10,
    ...shadow(4, 0.08),
  },
  commentsButtonText: {
    color: H.white,
    fontSize: 16,
    fontWeight: "700",
  },

  // Comments Overlay (Modal)
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  overlayContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SH * 0.85,
    backgroundColor: H.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow(10, 0.15),
  },
  overlayHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: H.cardBorder,
  },
  overlayHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: H.cardBorder,
    alignSelf: "center",
    marginBottom: 10,
  },
  overlayTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: H.textDark,
    fontFamily: "Georgia",
  },
  overlaySubtitle: {
    fontSize: 12,
    color: H.textMuted,
    marginTop: 2,
  },
  overlayFlex: {
    flex: 1,
  },
  overlayCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  overlayLoadingText: {
    marginTop: 12,
    color: H.textMuted,
    fontSize: 14,
  },

  commentsList: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyCommentsList: {
    flex: 1,
    justifyContent: "center",
  },

  commentItem: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 12,
  },
  commentChild: {
    marginLeft: 36,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: H.headerDeep,
    justifyContent: "center",
    alignItems: "center",
  },
  commentAvatarText: {
    color: H.white,
    fontSize: 14,
    fontWeight: "700",
  },
  commentContent: {
    flex: 1,
    backgroundColor: H.bg,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: H.cardBorder,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 2,
  },
  commentAuthor: {
    fontWeight: "700",
    fontSize: 13,
    color: H.textDark,
  },
  imamBadgeSmall: {
    backgroundColor: H.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  imamBadgeSmallText: {
    color: H.white,
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  commentTime: {
    fontSize: 10,
    color: H.textMuted,
    marginLeft: "auto",
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
    color: H.textDark,
    marginVertical: 4,
  },
  commentReplyAction: {
    fontSize: 12,
    fontWeight: "600",
    color: H.textMuted,
    marginTop: 4,
  },
  viewRepliesBtn: {
    marginTop: 6,
  },
  viewRepliesText: {
    fontSize: 11,
    color: H.goldDeep,
    fontWeight: "600",
  },

  emptyComments: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyCommentsTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: H.textDark,
    fontFamily: "Georgia",
    marginBottom: 4,
  },
  emptyCommentsSub: {
    fontSize: 14,
    color: H.textMuted,
    textAlign: "center",
  },

  // Input inside overlay
  overlayInputContainer: {
    backgroundColor: H.card,
    borderTopWidth: 1,
    borderTopColor: H.cardBorder,
    padding: 12,
    paddingBottom: Platform.OS === "ios" ? 30 : 12,
  },
  replyToIndicator: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  replyToText: {
    fontSize: 12,
    color: H.textMuted,
    fontStyle: "italic",
  },
  replyToCancel: {
    fontSize: 12,
    color: H.gold,
    fontWeight: "600",
  },
  inputWrapper: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end",
  },
  overlayInput: {
    flex: 1,
    backgroundColor: H.bg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
    fontSize: 15,
    color: H.textDark,
    borderWidth: 1,
    borderColor: H.cardBorder,
  },
  sendBtn: {
    backgroundColor: H.headerDeep,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    ...shadow(4, 0.06),
  },
  sendBtnDisabled: { opacity: 0.5 },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 148,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
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
  title: {
    color: H.white,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Georgia",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginRight: 8,
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
});