/**
 * ImamHadithScreen — Premium Hadith Dashboard
 * Matches AskQuestionScreen / HomeScreen palette and styling
 * No emojis · All text from i18n
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Modal, Alert, Platform, ActivityIndicator, StatusBar, ScrollView, Animated, Image, Dimensions } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { PermissionsAndroid } from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import Svg, { Path, Rect, Defs, LinearGradient, Stop, Circle } from "react-native-svg";
import Video from "react-native-video";
import Slider from "@react-native-community/slider";

import AudioRecord from "../lib/audioRecord";
import { getToken } from "../utils/secureStorage";
import { apiAxios, authApiFetch } from "../config/server";
import { COLORS as C, RADII, FONTS } from "../config/theme";
import { logger } from "../utils/logger";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { STATUSBAR_HEIGHT } from "../utils/statusBar";

// ─── Palette (identical source of truth as AskQuestionScreen) ──────
const H = {
  bg: "#FBF9F4",
  card: C.white,
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold: C.gold,
  goldLight: C.goldLight,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
  error: C.error,
  success: C.bgVivid,
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

// ─── SVG Icons (no emojis) ───────────────────────────────────────────
const PlusIcon = ({ color = H.white, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 4 V20 M4 12 H20" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </Svg>
);

const CloseIcon = ({ color = H.gold, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);

const ImagePlusIcon = ({ color = H.textDark, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="3" y="5" width="18" height="14" rx="2.5" stroke={color} strokeWidth={1.8} fill="none" />
    <Circle cx="9" cy="10.5" r="1.6" fill={color} />
    <Path d="M4 17 L9.5 12.5 L13 15.5 L16 12.5 L20 16.5" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const MicIcon = ({ color = H.textDark, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M6 11 A6 6 0 0 0 18 11 M12 17 V21 M9 21 H15" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
  </Svg>
);

const StopSquareIcon = ({ color = H.error, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="5" y="5" width="14" height="14" rx="3" fill={color} />
  </Svg>
);

const TrashIcon = ({ color = H.error, size = 16 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 7 H20 M9 7 V4.5 A1.5 1.5 0 0 1 10.5 3 H13.5 A1.5 1.5 0 0 1 15 4.5 V7 M6 7 L7 20 A1.5 1.5 0 0 0 8.5 21.3 H15.5 A1.5 1.5 0 0 0 17 20 L18 7"
      stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const PlayIcon = ({ color = H.headerDeep, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M7.5 5 L19 12 L7.5 19 Z" fill={color} />
  </Svg>
);

const PauseIcon = ({ color = H.headerDeep, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="5" width="4" height="14" rx="1.2" fill={color} />
    <Rect x="14" y="5" width="4" height="14" rx="1.2" fill={color} />
  </Svg>
);

const CheckmarkIcon = ({ color = H.white, size = 40 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="11" stroke={color} strokeWidth={2} fill="none" />
    <Path d="M7 12 L11 16 L18 8" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ─── Header Pattern (identical motif to AskQuestionScreen) ─────────
const HeaderPattern = ({ w = SW, h = 148 }) => {
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
};

// ─── Helper: Hijri date (same conversion used across the app) ──────
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
    return "";
  }
};

const formatDuration = (totalSeconds) => {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const authHeader = async () => {
  const token = await getToken();
  return { Authorization: `Bearer ${token}` };
};

const getAssetName = (asset) => {
  if (asset?.fileName) return asset.fileName;
  const uri = asset?.uri || "";
  const lastPart = uri.split("/").pop() || "hadith.jpg";
  return lastPart.split("?")[0];
};

const getAssetType = (asset) => {
  if (asset?.type) return asset.type;
  const name = getAssetName(asset).toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  return "image/jpeg";
};

const normalizeUploadUri = (uri) => {
  if (!uri) return uri;
  if (uri.startsWith("file://") || uri.startsWith("content://")) return uri;
  return `file://${uri}`;
};

// The picker is already restricted to `mediaType: "photo"`, so anything it
// returns is a real photo — Android content:// picks frequently come back
// with no filename extension at all, which was tripping a whitelist check
// and rejecting perfectly valid JPG/PNG photos. Block only formats we know
// the backend can't handle instead of requiring an exact extension match.
const UNSUPPORTED_IMAGE_MIMES = ["image/heic", "image/heif", "image/webp", "image/gif", "image/bmp", "image/tiff"];
const UNSUPPORTED_IMAGE_EXTENSIONS = /\.(heic|heif|webp|gif|bmp|tiff?)$/i;

const isUnsupportedImage = (asset) => {
  const mime = (asset?.type || "").toLowerCase();
  if (mime && UNSUPPORTED_IMAGE_MIMES.includes(mime)) return true;
  return UNSUPPORTED_IMAGE_EXTENSIONS.test(getAssetName(asset).toLowerCase());
};

// ─── Compact Header ──────────────────────────────────────────────────
const CompactHeader = ({ title, hijriDate, gregorianDate, onAdd }) => {
  const safeTitle = typeof title === "string" ? title : "";
  const safeGregorian = typeof gregorianDate === "string" ? gregorianDate : "";
  const safeHijri = typeof hijriDate === "string" ? hijriDate : "";

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
        <View style={hs.titleContainer}>
          <Text style={hs.title}>{safeTitle}</Text>
        </View>
        <AnimatedPressable onPress={onAdd} style={hs.addBtn} activeOpacity={0.85}>
          <PlusIcon />
        </AnimatedPressable>
      </View>

      <View style={hs.dateRow}>
        <Text style={hs.dateTxt}>{safeGregorian}</Text>
        <View style={hs.dateDot} />
        <Text style={hs.dateTxt}>{safeHijri}</Text>
      </View>
    </View>
  );
};

// ─── Main Component ──────────────────────────────────────────────────
export default function ImamHadithScreen() {
  const { t } = useTranslation();

  const [hadiths, setHadiths] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);

  const [arabic, setArabic] = useState("");
  const [translation, setTranslation] = useState("");
  const [source, setSource] = useState("");
  const [image, setImage] = useState(null);
  const [audioPath, setAudioPath] = useState(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const playerRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnim1 = useRef(new Animated.Value(0)).current;
  const waveAnim2 = useRef(new Animated.Value(0)).current;
  const waveAnim3 = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const modalFade = useRef(new Animated.Value(0)).current;

  const timerRef = useRef(null);
  const recordSecondsRef = useRef(0);

  const fetchHadith = async () => {
    try {
      const res = await apiAxios({ method: "get", url: "/hadith" });
      setHadiths(res.data);
    } catch (err) {
      logger.log("FETCH ERROR:", err.message);
    }
  };

  useEffect(() => { fetchHadith(); }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Recording animations
  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();

      const createWave = (anim, delay) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        );

      createWave(waveAnim1, 0).start();
      createWave(waveAnim2, 333).start();
      createWave(waveAnim3, 666).start();

      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      pulseAnim.setValue(1);
      waveAnim1.setValue(0);
      waveAnim2.setValue(0);
      waveAnim3.setValue(0);
      fadeAnim.setValue(0);
    }
  }, [recording]);

  const openModal = () => {
    setModalVisible(true);
    modalFade.setValue(0);
    Animated.timing(modalFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  };

  // Auto-stop recording whenever the modal is dismissed, to avoid a
  // dangling recorder / mic lock if the imam navigates away mid-recording.
  const closeModal = async () => {
    if (recordingRef.current) {
      await stopRecording();
    }
    setIsPlaying(false);
    setModalVisible(false);
  };

  const resetForm = () => {
    setArabic("");
    setTranslation("");
    setSource("");
    setImage(null);
    setAudioPath(null);
    setRecordedDuration(0);
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
  };

  const pickImage = async () => {
    const res = await launchImageLibrary({ mediaType: "photo" });
    if (res.assets?.length) setImage(res.assets[0]);
  };

  const uploadImage = async () => {
    if (!image) return null;
    const token = await getToken();
    const uri = Platform.OS === "android" ? normalizeUploadUri(image.uri) : image.uri;
    const fileName = getAssetName(image);
    const fileType = getAssetType(image);

    if (isUnsupportedImage(image)) {
      throw new Error(t("hadith.invalidImage"));
    }

    const formData = new FormData();
    formData.append("file", { uri, type: fileType, name: fileName });

    const res = await authApiFetch("/upload/image", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || t("hadith.imageUploadError"));
    return data.url;
  };

  const startRecording = async () => {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        return Alert.alert(t("hadith.permissionDeniedTitle"), t("hadith.permissionDeniedMsg"));
      }
    }
    AudioRecord.init({ sampleRate: 16000, channels: 1, bitsPerSample: 16, wavFile: "hadith.wav" });
    AudioRecord.start();
    recordingRef.current = true;
    setRecording(true);
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);

    recordSecondsRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      recordSecondsRef.current += 1;
      setRecordedDuration(recordSecondsRef.current);
    }, 1000);
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const path = await AudioRecord.stop();
    setAudioPath(path);
    recordingRef.current = false;
    setRecording(false);
    setRecordedDuration(recordSecondsRef.current);
    return path;
  };

  const removeAudio = () => {
    setIsPlaying(false);
    setAudioPath(null);
    setRecordedDuration(0);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
    recordSecondsRef.current = 0;
  };

  const togglePlayback = () => {
    if (!audioPath) return;
    // Restart from the top once a clip has finished playing.
    if (!isPlaying && playbackDuration > 0 && playbackPosition >= playbackDuration - 0.15) {
      playerRef.current?.seek(0);
      setPlaybackPosition(0);
    }
    setIsPlaying((p) => !p);
  };

  const handlePlaybackLoad = (data) => {
    if (data?.duration) setPlaybackDuration(data.duration);
  };

  const handlePlaybackProgress = (data) => {
    if (typeof data?.currentTime === "number") setPlaybackPosition(data.currentTime);
  };

  const handlePlaybackEnd = () => {
    setIsPlaying(false);
    setPlaybackPosition(0);
    playerRef.current?.seek(0);
  };

  const handleSeek = (value) => {
    playerRef.current?.seek(value);
    setPlaybackPosition(value);
  };

  const uploadAudio = async (path) => {
    if (!path) return null;
    const token = await getToken();
    const uri = Platform.OS === "android" ? normalizeUploadUri(path) : path;
    const formData = new FormData();
    formData.append("file", { uri, type: "audio/wav", name: "hadith.wav" });

    const res = await authApiFetch("/upload/audio", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || t("hadith.audioUploadError"));
    return data.url;
  };

  // AUTO-STOP RECORDING ON POST — guarantees the mic is always released
  // and the captured clip is uploaded, even if the imam forgot to tap Stop.
  const submitHadith = async () => {
    const hasContent = arabic.trim() || translation.trim() || image || audioPath;
    if (!hasContent) {
      return Alert.alert(t("hadith.emptyTitle"), t("hadith.emptyMsg"));
    }
    try {
      setLoading(true);
      let finalAudioPath = audioPath;
      if (recordingRef.current) finalAudioPath = await stopRecording();

      let imageUrl = null;
      let voiceUrl = null;

      if (image) imageUrl = await uploadImage();
      if (finalAudioPath) voiceUrl = await uploadAudio(finalAudioPath);

      await apiAxios({
        method: "post",
        url: "/hadith/",
        data: {
          arabic: arabic.trim() || null,
          translation: translation.trim() || null,
          source: source.trim() || null,
          image_url: imageUrl || null,
          voice_url: voiceUrl || null,
        },
        headers: await authHeader(),
      });

      Alert.alert(t("hadith.successTitle"), t("hadith.successMsg"));
      setModalVisible(false);
      resetForm();
      fetchHadith();
    } catch (err) {
      logger.log("HADITH POST ERROR:", err?.response?.data || err.message || err);
      Alert.alert(t("hadith.errorTitle"), err?.response?.data?.detail || err.message || t("hadith.postError"));
    } finally {
      setLoading(false);
    }
  };

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <View style={styles.root}>

      <CompactHeader
        title={t("hadith.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
        onAdd={openModal}
      />

      <FlatList
        data={hadiths}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardText}>{item.translation}</Text>
            <View style={styles.cardFooter}>
              {!!item.source && <Text style={styles.cardSource}>{item.source}</Text>}
              <View style={styles.cardBadges}>
                {!!item.image_url && (
                  <View style={styles.badge}>
                    <ImagePlusIcon color={H.goldDeep} size={13} />
                  </View>
                )}
                {!!item.voice_url && (
                  <View style={styles.badge}>
                    <MicIcon color={H.goldDeep} size={13} />
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t("hadith.emptyState")}</Text>
          </View>
        }
      />

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("hadith.modalTitle")}</Text>
            <AnimatedPressable onPress={closeModal}>
              <Text style={styles.closeBtnText}>{t("common.close")}</Text>
            </AnimatedPressable>
          </View>

          <Animated.ScrollView
            style={[styles.modalContent, { opacity: modalFade }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>{t("hadith.arabicLabel")}</Text>
            <TextInput
              value={arabic}
              onChangeText={setArabic}
              style={[styles.input, styles.arabicInput]}
              placeholder={t("hadith.arabicPlaceholder")}
              placeholderTextColor={H.textMuted}
              multiline
              textAlign="right"
            />

            <Text style={styles.label}>{t("hadith.translationLabel")}</Text>
            <TextInput
              value={translation}
              onChangeText={setTranslation}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.translationInput]}
              placeholder={t("hadith.translationPlaceholder")}
              placeholderTextColor={H.textMuted}
            />

            <Text style={styles.label}>{t("hadith.sourceLabel")}</Text>
            <TextInput
              value={source}
              onChangeText={setSource}
              style={styles.input}
              placeholder={t("hadith.sourcePlaceholder")}
              placeholderTextColor={H.textMuted}
            />

            {/* ── Image preview ─────────────────────────────── */}
            {image && (
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>{t("hadith.imageLabel")}</Text>
                <AnimatedPressable
                  style={styles.imagePreviewBox}
                  activeOpacity={0.85}
                  onPress={() => setImagePreviewVisible(true)}
                >
                  <Image source={{ uri: image.uri }} style={styles.imageThumb} resizeMode="cover" />
                  <View style={styles.imagePreviewMeta}>
                    <Text style={styles.fileName} numberOfLines={1}>{getAssetName(image)}</Text>
                    <Text style={styles.tapHint}>{t("hadith.tapToView")}</Text>
                  </View>
                  <AnimatedPressable onPress={() => setImage(null)} style={styles.removeChip}>
                    <TrashIcon />
                  </AnimatedPressable>
                </AnimatedPressable>
              </View>
            )}

            {/* ── Audio preview (post-recording, real playback) ── */}
            {audioPath && !recording && (
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>{t("hadith.audioLabel")}</Text>
                <View style={styles.audioPreviewBox}>
                  <View style={styles.audioTopRow}>
                    <AnimatedPressable style={styles.playBtn} onPress={togglePlayback} activeOpacity={0.85}>
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </AnimatedPressable>
                    <View style={styles.audioPreviewMeta}>
                      <Text style={styles.audioPreviewTitle}>{t("hadith.voiceNote")}</Text>
                      <Text style={styles.audioDuration}>
                        {formatDuration(playbackPosition)} / {formatDuration(playbackDuration || recordedDuration)}
                      </Text>
                    </View>
                    <AnimatedPressable onPress={removeAudio} style={styles.removeChip}>
                      <TrashIcon />
                    </AnimatedPressable>
                  </View>

                  <Slider
                    style={styles.audioSlider}
                    minimumValue={0}
                    maximumValue={Math.max(playbackDuration || recordedDuration, 0.1)}
                    value={playbackPosition}
                    minimumTrackTintColor={H.headerLight}
                    maximumTrackTintColor={H.cardBorder}
                    thumbTintColor={H.gold}
                    onSlidingComplete={handleSeek}
                  />

                  <Video
                    ref={playerRef}
                    source={{ uri: Platform.OS === "android" ? normalizeUploadUri(audioPath) : audioPath }}
                    paused={!isPlaying}
                    audioOnly
                    ignoreSilentSwitch="ignore"
                    onLoad={handlePlaybackLoad}
                    onProgress={handlePlaybackProgress}
                    onEnd={handlePlaybackEnd}
                    onError={(e) => logger.log("AUDIO PLAYBACK ERROR:", e)}
                    style={styles.hiddenPlayer}
                  />
                </View>
              </View>
            )}

            {/* ── Live recording state ───────────────────────── */}
            {recording && (
              <Animated.View style={[styles.recordingBox, { opacity: fadeAnim }]}>
                <View style={styles.waveContainer}>
                  <Animated.View style={[styles.wave, { transform: [{ scale: waveAnim1 }], opacity: waveAnim1.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }]} />
                  <Animated.View style={[styles.wave, { transform: [{ scale: waveAnim2 }], opacity: waveAnim2.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }]} />
                  <Animated.View style={[styles.wave, { transform: [{ scale: waveAnim3 }], opacity: waveAnim3.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }]} />
                  <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
                </View>
                <Text style={styles.recordingTimer}>{formatDuration(recordedDuration)}</Text>
                <Text style={styles.recordingText}>{t("hadith.recording")}</Text>
                <Text style={styles.recordingSub}>{t("hadith.recordingSub")}</Text>
              </Animated.View>
            )}

            <View style={styles.buttonGroup}>
              <AnimatedPressable
                style={[styles.secondaryBtn, image && styles.activeBtn]}
                onPress={pickImage}
                disabled={recording}
                activeOpacity={0.85}
              >
                <ImagePlusIcon color={image ? H.headerDeep : H.textDark} />
                <Text style={[styles.secondaryBtnText, image && { color: H.headerDeep }]}>
                  {image ? t("hadith.changeImage") : t("hadith.addImage")}
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={[styles.recordBtn, recording && styles.recordingBtnActive]}
                onPress={recording ? stopRecording : startRecording}
                activeOpacity={0.85}
              >
                <Animated.View style={recording && { transform: [{ scale: pulseAnim }] }}>
                  {recording ? <StopSquareIcon /> : <MicIcon />}
                </Animated.View>
                <Text style={[styles.recordBtnText, recording && { color: H.error }]}>
                  {recording ? t("hadith.stop") : t("hadith.record")}
                </Text>
              </AnimatedPressable>
            </View>

            <AnimatedPressable
              style={[styles.submit, loading && styles.submitDisabled]}
              onPress={submitHadith}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={H.white} />
              ) : (
                <Text style={styles.submitText}>
                  {recording ? t("hadith.stopAndPost") : t("hadith.submit")}
                </Text>
              )}
            </AnimatedPressable>
            <View style={{ height: 40 }} />
          </Animated.ScrollView>
        </View>
      </Modal>

      {/* ── Full-size image viewer ────────────────────────────── */}
      <Modal
        visible={imagePreviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImagePreviewVisible(false)}
      >
        <AnimatedPressable
          style={styles.imageViewerBackdrop}
          activeOpacity={1}
          onPress={() => setImagePreviewVisible(false)}
        >
          {image && (
            <Image source={{ uri: image.uri }} style={styles.imageViewerFull} resizeMode="contain" />
          )}
          <AnimatedPressable style={styles.imageViewerClose} onPress={() => setImagePreviewVisible(false)}>
            <CloseIcon color={H.white} />
          </AnimatedPressable>
        </AnimatedPressable>
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  listContent: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: H.card,
    marginBottom: 12,
    padding: 18,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: H.cardBorder,
    ...shadow(4, 0.06),
  },
  cardText: { fontSize: 15, lineHeight: 24, color: H.textDark },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  cardSource: { fontSize: 13, color: H.headerLight, fontWeight: "700" },
  cardBadges: { flexDirection: "row", gap: 6 },
  badge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: H.goldLight + "25",
    borderWidth: 1, borderColor: H.goldLight + "50",
    justifyContent: "center", alignItems: "center",
  },
  emptyState: { alignItems: "center", marginTop: 60 },
  emptyText: { fontSize: 15, color: H.textMuted },

  modalContainer: { flex: 1, backgroundColor: H.bg },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: IOS ? 60 : 20, paddingBottom: 16,
    backgroundColor: H.card, borderBottomWidth: 1, borderBottomColor: H.cardBorder,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: H.textDark, fontFamily: FONTS.display },
  closeBtnText: { color: H.headerLight, fontSize: 16, fontWeight: "600" },
  modalContent: { padding: 20 },

  label: { fontSize: 14, fontWeight: "700", color: H.textDark, marginBottom: 8, marginTop: 20, fontFamily: FONTS.display },
  input: {
    backgroundColor: H.card, padding: 16, borderRadius: RADII.md,
    borderWidth: 1, borderColor: H.cardBorder, fontSize: 15, color: H.textDark,
    ...shadow(3, 0.04),
  },
  arabicInput: { minHeight: 80, textAlign: "right", fontSize: 18 },
  translationInput: { minHeight: 120, textAlignVertical: "top" },

  previewSection: { marginTop: 20 },
  previewLabel: { fontSize: 12, fontWeight: "700", color: H.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },

  imagePreviewBox: {
    flexDirection: "row", alignItems: "center", backgroundColor: H.card,
    padding: 12, borderRadius: RADII.md, borderWidth: 1, borderColor: H.cardBorder, ...shadow(3, 0.04),
  },
  imageThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: H.cardBorder },
  imagePreviewMeta: { flex: 1, marginLeft: 12 },
  fileName: { fontSize: 14, color: H.textDark, fontWeight: "600" },
  tapHint: { fontSize: 11, color: H.textMuted, marginTop: 2 },
  removeChip: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: H.error + "14",
    justifyContent: "center", alignItems: "center", marginLeft: 8,
  },

  audioPreviewBox: {
    backgroundColor: H.card, padding: 12, borderRadius: RADII.md,
    borderWidth: 1, borderColor: H.cardBorder, ...shadow(3, 0.04),
  },
  audioTopRow: { flexDirection: "row", alignItems: "center" },
  playBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: H.goldLight + "20",
    borderWidth: 1, borderColor: H.goldLight + "40", justifyContent: "center", alignItems: "center",
  },
  audioPreviewMeta: { flex: 1, marginLeft: 12 },
  audioPreviewTitle: { fontSize: 14, color: H.textDark, fontWeight: "600" },
  audioDuration: { fontSize: 13, color: H.textMuted, marginTop: 2, fontVariant: ["tabular-nums"] },
  audioSlider: { width: "100%", height: 32, marginTop: 4 },
  hiddenPlayer: { width: 0, height: 0 },

  recordingBox: { alignItems: "center", marginVertical: 24 },
  waveContainer: { width: 80, height: 80, justifyContent: "center", alignItems: "center", marginBottom: 12 },
  wave: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: H.error },
  recordingDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: H.error },
  recordingTimer: { fontSize: 22, fontWeight: "800", color: H.textDark, fontVariant: ["tabular-nums"], marginBottom: 2 },
  recordingText: { fontSize: 16, fontWeight: "700", color: H.error },
  recordingSub: { fontSize: 13, color: H.textMuted, marginTop: 4 },

  buttonGroup: { flexDirection: "row", gap: 12, marginTop: 24 },
  secondaryBtn: {
    flex: 1, backgroundColor: H.card, padding: 16, borderRadius: RADII.md, alignItems: "center",
    flexDirection: "row", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: H.cardBorder,
  },
  activeBtn: { borderColor: H.headerLight, backgroundColor: H.goldLight + "15" },
  secondaryBtnText: { color: H.textDark, fontWeight: "700", fontSize: 15 },
  recordBtn: {
    flex: 1, backgroundColor: H.card, padding: 16, borderRadius: RADII.md, alignItems: "center",
    flexDirection: "row", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: H.cardBorder,
  },
  recordingBtnActive: { borderColor: H.error, backgroundColor: H.error + "12" },
  recordBtnText: { color: H.textDark, fontWeight: "700", fontSize: 15 },

  submit: {
    backgroundColor: H.headerDeep, padding: 18, marginTop: 24, borderRadius: RADII.md, alignItems: "center",
    ...shadow(6, 0.12),
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: H.white, fontWeight: "700", fontSize: 16 },

  imageViewerBackdrop: {
    flex: 1, backgroundColor: "rgba(5,20,14,0.92)", justifyContent: "center", alignItems: "center",
  },
  imageViewerFull: { width: SW - 32, height: "70%" },
  imageViewerClose: {
    position: "absolute", top: STATUSBAR_HEIGHT + 12, right: 20,
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center",
  },
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
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  titleContainer: { flex: 1, marginRight: 12 },
  title: { color: H.white, fontSize: 18, fontWeight: "700", fontFamily: FONTS.display },
  addBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: H.gold,
    justifyContent: "center", alignItems: "center", ...shadow(4, 0.2),
  },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: 12, marginRight: 8 },
  dateTxt: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600", marginRight: 8 },
  dateDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: H.goldLight, marginRight: 8 },
});