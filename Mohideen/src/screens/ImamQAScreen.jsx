import React, { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Modal, Alert, Platform, ActivityIndicator, StatusBar, ScrollView, Animated, Image, Dimensions } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { PermissionsAndroid } from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import Svg, { Path, Rect, Defs, LinearGradient, Stop, Circle } from "react-native-svg";
import Slider from "@react-native-community/slider";
import Video from "react-native-video";

import AudioRecord from "../lib/audioRecord";
import { getToken } from "../utils/secureStorage";
import { apiAxios, authApiFetch } from "../config/server";
import { COLORS, RADII, FONTS } from "../config/theme";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { STATUSBAR_HEIGHT } from "../utils/statusBar";
import { useTopInset } from "../hooks/useSafeArea";

// ─── Palette directly from theme ─────────────────────────────────────
const C = {
  bg: "#FBF9F4",                  // ivory background
  card: COLORS.white,
  cardBorder: "rgba(212,175,55,0.2)",
  headerDeep: COLORS.bg,           // deep forest green
  headerLight: COLORS.bgVivid,     // vivid green
  gold: COLORS.gold,
  goldLight: COLORS.goldLight,
  goldDeep: COLORS.goldDeep,
  textDark: COLORS.textDark,
  textMuted: COLORS.textMuted,
  white: COLORS.white,
  error: COLORS.error,
  success: COLORS.bgVivid,
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: {
      shadowColor: "#0B3D2E",
      shadowOffset: { width: 0, height: y },
      shadowOpacity: opacity,
      shadowRadius: y * 1.6,
    },
    android: { elevation: y },
  });

// ─── Hijri date helpers (identical to Hadith screen) ─────────────────
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

// ─── SVG Icons (premium, no emojis) ──────────────────────────────────
const BackArrowIcon = ({ color = C.goldLight, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 4 L7 12 L15 20" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
  </Svg>
);

const RefreshIcon = ({ color = C.goldLight, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 12 A8 8 0 0 1 18.1 8.5 M20 12 A8 8 0 0 1 5.9 15.5" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    <Path d="M15.5 4.5 L18.5 8.5 L15.5 12.5" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M8.5 19.5 L5.5 15.5 L8.5 11.5" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CloseIcon = ({ color = C.gold, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);

const ImagePlusIcon = ({ color = C.textDark, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="3" y="5" width="18" height="14" rx="2.5" stroke={color} strokeWidth={1.8} fill="none" />
    <Circle cx="9" cy="10.5" r="1.6" fill={color} />
    <Path d="M4 17 L9.5 12.5 L13 15.5 L16 12.5 L20 16.5" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const MicIcon = ({ color = C.textDark, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M6 11 A6 6 0 0 0 18 11 M12 17 V21 M9 21 H15" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
  </Svg>
);

const StopSquareIcon = ({ color = C.error, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="5" y="5" width="14" height="14" rx="3" fill={color} />
  </Svg>
);

const TrashIcon = ({ color = C.error, size = 16 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 7 H20 M9 7 V4.5 A1.5 1.5 0 0 1 10.5 3 H13.5 A1.5 1.5 0 0 1 15 4.5 V7 M6 7 L7 20 A1.5 1.5 0 0 0 8.5 21.3 H15.5 A1.5 1.5 0 0 0 17 20 L18 7"
      stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const PlayIcon = ({ color = C.headerDeep, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M7.5 5 L19 12 L7.5 19 Z" fill={color} />
  </Svg>
);

const PauseIcon = ({ color = C.headerDeep, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="5" width="4" height="14" rx="1.2" fill={color} />
    <Rect x="14" y="5" width="4" height="14" rx="1.2" fill={color} />
  </Svg>
);

const SpeedIcon = ({ color = C.headerDeep, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={2} fill="none" />
    <Path d="M12 6 V12 L16 14" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
  </Svg>
);

const VoiceIcon = ({ color = C.goldDeep, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M6 11 A6 6 0 0 0 18 11 M12 17 V21" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
  </Svg>
);

// ─── Header Pattern (gold star pattern) ──────────────────────────────
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
        <Path key={i} d={d} fill={C.gold} opacity={0.06} />
      ))}
    </Svg>
  );
};

// ─── Compact Header ──────────────────────────────────────────────────
const CompactHeader = ({ title, hijriDate, gregorianDate, onBackPress, onRefreshPress }) => {
  const topInset = useTopInset();
  return (
    <View style={[hs.wrap, { paddingTop: topInset }]}>
      <Svg width={SW} height={148 + topInset} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset={0} stopColor={C.headerDeep} />
            <Stop offset={1} stopColor={C.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148 + topInset} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />
      <View style={hs.row}>
        <AnimatedPressable style={hs.backBtn} onPress={onBackPress}>
          <BackArrowIcon />
        </AnimatedPressable>
        <Text style={hs.title}>{title}</Text>
        <AnimatedPressable style={hs.refreshBtn} onPress={onRefreshPress}>
          <RefreshIcon />
        </AnimatedPressable>
      </View>
      <View style={hs.dateRow}>
        <Text style={hs.dateTxt}>{gregorianDate}</Text>
        <View style={hs.dateDot} />
        <Text style={hs.dateTxt}>{hijriDate}</Text>
      </View>
    </View>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────
const formatDuration = (totalSeconds) => {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const getAssetName = (asset) => {
  if (asset?.fileName) return asset.fileName;
  const uri = asset?.uri || "";
  const lastPart = uri.split("/").pop() || "qa_image.jpg";
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

const isUnsupportedImage = (asset) => {
  const unsupportedMimes = ["image/heic", "image/heif", "image/webp", "image/gif", "image/bmp", "image/tiff"];
  const mime = (asset?.type || "").toLowerCase();
  if (mime && unsupportedMimes.includes(mime)) return true;
  return /\.(heic|heif|webp|gif|bmp|tiff?)$/i.test(getAssetName(asset).toLowerCase());
};

// ─── Main Component ──────────────────────────────────────────────────
export default function ImamQAScreen({ navigation }) {
  const { t } = useTranslation();

  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState(null);

  // Form
  const [answerText, setAnswerText] = useState("");
  const [image, setImage] = useState(null);
  const [audioPath, setAudioPath] = useState(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const playerRef = useRef(null);

  // Recording
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const timerRef = useRef(null);
  const recordSecondsRef = useRef(0);

  // Submission states
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnim1 = useRef(new Animated.Value(0)).current;
  const waveAnim2 = useRef(new Animated.Value(0)).current;
  const waveAnim3 = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const modalFade = useRef(new Animated.Value(0)).current;

  // Image preview modal
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);

  // Hijri date for header
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  // Fetch pending questions
  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const res = await apiAxios({
        method: "get",
        url: "/questions/pending",
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      setQuestions(res.data);
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message;
      Alert.alert(t("qa.fetchErrorTitle"), t("qa.fetchErrorMsg") + ": " + msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  // Recording animations
  useEffect(() => {
    if (recording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Modal open / close
  const openModal = (question) => {
    setSelectedQuestion(question);
    setAnswerText("");
    setImage(null);
    setAudioPath(null);
    setRecordedDuration(0);
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
    setPlaybackRate(1);
    recordSecondsRef.current = 0;
    setModalVisible(true);
    modalFade.setValue(0);
    Animated.timing(modalFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  };

  const closeModal = async () => {
    if (recordingRef.current) {
      await stopRecording();
    }
    setIsPlaying(false);
    setModalVisible(false);
  };

  // Image picker
  const pickImage = async () => {
    const result = await launchImageLibrary({ mediaType: "photo" });
    if (result.assets?.length) {
      const asset = result.assets[0];
      if (isUnsupportedImage(asset)) {
        Alert.alert(t("qa.invalidImageTitle"), t("qa.invalidImageMsg"));
        return;
      }
      setImage(asset);
    }
  };

  const uploadImage = async () => {
    if (!image) return null;
    const token = await getToken();
    const uri = Platform.OS === "android" ? normalizeUploadUri(image.uri) : image.uri;
    const fileName = getAssetName(image);
    const fileType = getAssetType(image);

    const formData = new FormData();
    formData.append("file", { uri, type: fileType, name: fileName });

    const res = await authApiFetch("/upload/image", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || t("qa.imageUploadError"));
    return data.url;
  };

  // Audio recording
  const startRecording = async () => {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        return Alert.alert(t("qa.permissionDeniedTitle"), t("qa.permissionDeniedMsg"));
      }
    }
    setAudioPath(null);
    setRecordedDuration(0);
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
    recordSecondsRef.current = 0;

    AudioRecord.init({ sampleRate: 16000, channels: 1, bitsPerSample: 16, wavFile: "qa_answer.wav" });
    AudioRecord.start();
    recordingRef.current = true;
    setRecording(true);

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

  // Playback
  const togglePlayback = () => {
    if (!audioPath) return;
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

  const toggleSpeed = () => {
    setPlaybackRate((prev) => (prev === 1 ? 2 : 1));
  };

  // Audio upload
  const uploadAudio = async (path) => {
    if (!path) return null;
    const token = await getToken();
    const uri = Platform.OS === "android" ? normalizeUploadUri(path) : path;
    const formData = new FormData();
    formData.append("file", { uri, type: "audio/wav", name: "qa_answer.wav" });

    const res = await authApiFetch("/upload/audio", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || t("qa.audioUploadError"));
    return data.url;
  };

  // Submit answer
  const submitAnswer = async () => {
    const textTrimmed = answerText.trim();
    if (recordingRef.current) {
      await stopRecording();
    }
    if (!textTrimmed && !audioPath && !image) {
      Alert.alert(t("qa.emptyAnswerTitle"), t("qa.emptyAnswerMsg"));
      return;
    }
    try {
      setSubmitting(true);
      let imageUrl = null;
      let voiceUrl = null;
      if (image) imageUrl = await uploadImage();
      if (audioPath) voiceUrl = await uploadAudio(audioPath);

      await apiAxios({
        method: "put",
        url: `/questions/${selectedQuestion.id}/answer`,
        data: {
          answer_text: textTrimmed || null,
          answer_voice_url: voiceUrl,
          answer_image_url: imageUrl,
        },
        headers: { Authorization: `Bearer ${await getToken()}` },
      });

      Alert.alert(t("qa.successTitle"), t("qa.successMsg"));
      closeModal();
      setAnswerText("");
      setImage(null);
      setAudioPath(null);
      fetchQuestions();
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message;
      Alert.alert(t("qa.errorTitle"), t("qa.submitErrorMsg") + ": " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Render question card
  const renderQuestion = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.questionText}>{item.question_text}</Text>
      {item.voice_url && (
        <View style={styles.voiceChip}>
          <VoiceIcon color={C.headerLight} size={14} />
          <Text style={styles.voiceChipText}>{t("qa.voiceQuestion")}</Text>
        </View>
      )}
      <Text style={styles.timeText}>
        {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
      </Text>
      <AnimatedPressable style={styles.answerBtn} onPress={() => openModal(item)} activeOpacity={0.85}>
        <Text style={styles.answerBtnText}>{t("qa.answerThis")}</Text>
      </AnimatedPressable>
    </View>
  );

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.headerDeep} />

      <CompactHeader
        title={t("qa.title")}
        hijriDate={hijriDate}
        gregorianDate={gregorianDate}
        onBackPress={() => navigation.goBack()}
        onRefreshPress={fetchQuestions}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.headerDeep} />
          <Text style={styles.centerText}>{t("qa.loading")}</Text>
        </View>
      ) : questions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{t("qa.emptyTitle")}</Text>
          <Text style={styles.centerText}>{t("qa.emptyMsg")}</Text>
        </View>
      ) : (
        <FlatList
          data={questions}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderQuestion}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Answer modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("qa.answerModalTitle")}</Text>
            <AnimatedPressable onPress={closeModal}>
              <CloseIcon />
            </AnimatedPressable>
          </View>

          <Animated.ScrollView
            style={[styles.modalContent, { opacity: modalFade }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {selectedQuestion && (
              <View style={styles.questionBubble}>
                <Text style={styles.questionLabel}>{t("qa.questionLabel")}</Text>
                <Text style={styles.questionBubbleText}>{selectedQuestion.question_text}</Text>
              </View>
            )}

            <Text style={styles.label}>{t("qa.textAnswerLabel")}</Text>
            <TextInput
              value={answerText}
              onChangeText={setAnswerText}
              multiline
              textAlignVertical="top"
              style={styles.textInput}
              placeholder={t("qa.textPlaceholder")}
              placeholderTextColor={C.textMuted}
            />

            {image && (
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>{t("qa.imageLabel")}</Text>
                <AnimatedPressable
                  style={styles.imagePreviewBox}
                  activeOpacity={0.85}
                  onPress={() => setImagePreviewVisible(true)}
                >
                  <Image source={{ uri: image.uri }} style={styles.imageThumb} resizeMode="cover" />
                  <View style={styles.imagePreviewMeta}>
                    <Text style={styles.fileName} numberOfLines={1}>{getAssetName(image)}</Text>
                    <Text style={styles.tapHint}>{t("qa.tapToView")}</Text>
                  </View>
                  <AnimatedPressable onPress={() => setImage(null)} style={styles.removeChip}>
                    <TrashIcon />
                  </AnimatedPressable>
                </AnimatedPressable>
              </View>
            )}

            {audioPath && !recording && (
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>{t("qa.audioLabel")}</Text>
                <View style={styles.audioPreviewBox}>
                  <View style={styles.audioTopRow}>
                    <AnimatedPressable style={styles.playBtn} onPress={togglePlayback} activeOpacity={0.85}>
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </AnimatedPressable>
                    <View style={styles.audioPreviewMeta}>
                      <Text style={styles.audioPreviewTitle}>{t("qa.yourRecording")}</Text>
                      <Text style={styles.audioDuration}>
                        {formatDuration(playbackPosition)} / {formatDuration(playbackDuration || recordedDuration)}
                      </Text>
                    </View>
                    <AnimatedPressable style={styles.removeChip} onPress={removeAudio}>
                      <TrashIcon />
                    </AnimatedPressable>
                  </View>

                  <View style={styles.audioControls}>
                    <Slider
                      style={styles.audioSlider}
                      minimumValue={0}
                      maximumValue={Math.max(playbackDuration || recordedDuration, 0.1)}
                      value={playbackPosition}
                      minimumTrackTintColor={C.headerLight}
                      maximumTrackTintColor={C.cardBorder}
                      thumbTintColor={C.gold}
                      onSlidingComplete={handleSeek}
                    />
                    <AnimatedPressable onPress={toggleSpeed} style={styles.speedBtn} activeOpacity={0.85}>
                      <SpeedIcon color={C.headerDeep} size={18} />
                      <Text style={styles.speedText}>{playbackRate}x</Text>
                    </AnimatedPressable>
                  </View>

                  <Video
                    ref={playerRef}
                    source={{ uri: Platform.OS === "android" ? normalizeUploadUri(audioPath) : audioPath }}
                    paused={!isPlaying}
                    rate={playbackRate}
                    audioOnly
                    ignoreSilentSwitch="ignore"
                    onLoad={handlePlaybackLoad}
                    onProgress={handlePlaybackProgress}
                    onEnd={handlePlaybackEnd}
                    style={styles.hiddenPlayer}
                  />
                </View>
              </View>
            )}

            {recording && (
              <Animated.View style={[styles.recordingBox, { opacity: fadeAnim }]}>
                <View style={styles.waveContainer}>
                  <Animated.View style={[styles.wave, { transform: [{ scale: waveAnim1 }], opacity: waveAnim1.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }]} />
                  <Animated.View style={[styles.wave, { transform: [{ scale: waveAnim2 }], opacity: waveAnim2.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }]} />
                  <Animated.View style={[styles.wave, { transform: [{ scale: waveAnim3 }], opacity: waveAnim3.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }]} />
                  <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
                </View>
                <Text style={styles.recordingTimer}>{formatDuration(recordedDuration)}</Text>
                <Text style={styles.recordingText}>{t("qa.recording")}</Text>
                <Text style={styles.recordingSub}>{t("qa.recordingHint")}</Text>
              </Animated.View>
            )}

            <View style={styles.buttonGroup}>
              <AnimatedPressable
                style={[styles.secondaryBtn, image && styles.activeBtn]}
                onPress={pickImage}
                disabled={recording}
                activeOpacity={0.85}
              >
                <ImagePlusIcon color={image ? C.headerDeep : C.textDark} />
                <Text style={[styles.secondaryBtnText, image && { color: C.headerDeep }]}>
                  {image ? t("qa.changeImage") : t("qa.addImage")}
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={[styles.recordBtn, recording && styles.recordingBtnActive]}
                onPress={recording ? stopRecording : startRecording}
                activeOpacity={0.85}
              >
                {recording ? <StopSquareIcon /> : <MicIcon />}
                <Text style={[styles.recordBtnText, recording && { color: C.error }]}>
                  {recording ? t("qa.stop") : t("qa.record")}
                </Text>
              </AnimatedPressable>
            </View>

            <AnimatedPressable
              style={[styles.submitBtn, submitting && styles.submitDisabled]}
              onPress={submitAnswer}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color={C.white} />
              ) : (
                <Text style={styles.submitText}>
                  {recording ? t("qa.stopAndSubmit") : t("qa.submit")}
                </Text>
              )}
            </AnimatedPressable>
            <View style={{ height: 40 }} />
          </Animated.ScrollView>
        </View>
      </Modal>

      {/* Full-screen image preview */}
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
          {image && <Image source={{ uri: image.uri }} style={styles.imageViewerFull} resizeMode="contain" />}
          <AnimatedPressable style={styles.imageViewerClose} onPress={() => setImagePreviewVisible(false)}>
            <CloseIcon color={C.white} />
          </AnimatedPressable>
        </AnimatedPressable>
      </Modal>
    </View>
  );
}

// ─── Styles (using premium palette) ──────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: C.card,
    padding: 18,
    borderRadius: RADII.xl,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
    ...shadow(4, 0.06),
  },
  questionText: { fontSize: 15, lineHeight: 24, color: C.textDark },
  timeText: { fontSize: 11, color: C.textMuted, marginTop: 6 },
  voiceChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.goldLight + "20",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 8,
    gap: 4,
  },
  voiceChipText: { fontSize: 11, color: C.headerLight, fontWeight: "600" },
  answerBtn: {
    marginTop: 14,
    backgroundColor: C.headerDeep,
    padding: 12,
    borderRadius: RADII.md,
    alignItems: "center",
    ...shadow(4, 0.1),
  },
  answerBtnText: { color: C.white, fontWeight: "700", fontSize: 15 },

  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 30 },
  centerText: { color: C.textMuted, fontSize: 14, marginTop: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.textDark, marginBottom: 4 },

  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: IOS ? 60 : 20,
    paddingBottom: 16,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: C.textDark, fontFamily: FONTS.display },
  modalContent: { padding: 20 },

  questionBubble: {
    backgroundColor: C.goldLight + "18",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderLeftWidth: 3,
    borderLeftColor: C.gold,
  },
  questionLabel: { fontSize: 11, fontWeight: "700", color: C.goldDeep, marginBottom: 4, textTransform: "uppercase" },
  questionBubbleText: { fontSize: 14, color: C.textDark, lineHeight: 20 },

  label: { fontSize: 13, fontWeight: "700", color: C.textDark, marginBottom: 8, marginTop: 18, fontFamily: FONTS.display },
  textInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: RADII.md,
    padding: 14,
    height: 120,
    fontSize: 15,
    color: C.textDark,
    textAlignVertical: "top",
    ...shadow(3, 0.04),
  },

  previewSection: { marginTop: 20 },
  previewLabel: { fontSize: 12, fontWeight: "700", color: C.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },

  imagePreviewBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    padding: 12,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: C.cardBorder,
    ...shadow(3, 0.04),
  },
  imageThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: C.cardBorder },
  imagePreviewMeta: { flex: 1, marginLeft: 12 },
  fileName: { fontSize: 14, color: C.textDark, fontWeight: "600" },
  tapHint: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  removeChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.error + "14",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  audioPreviewBox: {
    backgroundColor: C.card,
    padding: 12,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: C.cardBorder,
    ...shadow(3, 0.04),
  },
  audioTopRow: { flexDirection: "row", alignItems: "center" },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.goldLight + "20",
    borderWidth: 1,
    borderColor: C.goldLight + "40",
    justifyContent: "center",
    alignItems: "center",
  },
  audioPreviewMeta: { flex: 1, marginLeft: 12 },
  audioPreviewTitle: { fontSize: 14, color: C.textDark, fontWeight: "600" },
  audioDuration: { fontSize: 13, color: C.textMuted, marginTop: 2, fontVariant: ["tabular-nums"] },
  audioControls: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  audioSlider: { flex: 1, height: 32 },
  speedBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.goldLight + "25",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginLeft: 8,
    gap: 4,
  },
  speedText: { fontSize: 13, fontWeight: "700", color: C.headerDeep },
  hiddenPlayer: { width: 0, height: 0 },

  recordingBox: { alignItems: "center", marginVertical: 24 },
  waveContainer: { width: 80, height: 80, justifyContent: "center", alignItems: "center", marginBottom: 12 },
  wave: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: C.error },
  recordingDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.error },
  recordingTimer: { fontSize: 22, fontWeight: "800", color: C.textDark, fontVariant: ["tabular-nums"], marginBottom: 2 },
  recordingText: { fontSize: 16, fontWeight: "700", color: C.error },
  recordingSub: { fontSize: 13, color: C.textMuted, marginTop: 4 },

  buttonGroup: { flexDirection: "row", gap: 12, marginTop: 24 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: C.card,
    padding: 16,
    borderRadius: RADII.md,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  activeBtn: { borderColor: C.headerLight, backgroundColor: C.goldLight + "15" },
  secondaryBtnText: { color: C.textDark, fontWeight: "700", fontSize: 15 },
  recordBtn: {
    flex: 1,
    backgroundColor: C.card,
    padding: 16,
    borderRadius: RADII.md,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  recordingBtnActive: { borderColor: C.error, backgroundColor: C.error + "12" },
  recordBtnText: { color: C.textDark, fontWeight: "700", fontSize: 15 },

  submitBtn: {
    backgroundColor: C.headerDeep,
    padding: 18,
    marginTop: 24,
    borderRadius: RADII.md,
    alignItems: "center",
    ...shadow(6, 0.12),
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: C.white, fontWeight: "700", fontSize: 16 },

  imageViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(5,20,14,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageViewerFull: { width: SW - 32, height: "70%" },
  imageViewerClose: {
    position: "absolute",
    top: STATUSBAR_HEIGHT + 12,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
});

// ─── Header styles ───────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: {
    height: 148,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  backBtn: { width: 40, alignItems: "flex-start", padding: 4 },
  title: { color: C.white, fontSize: 18, fontWeight: "700", fontFamily: FONTS.display, flex: 1, textAlign: "center" },
  refreshBtn: { width: 40, alignItems: "flex-end", padding: 4 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 12 },
  dateTxt: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600", marginRight: 8 },
  dateDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.goldLight, marginRight: 8 },
});