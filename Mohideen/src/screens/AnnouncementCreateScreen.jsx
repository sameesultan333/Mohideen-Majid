/**
 * AnnouncementScreen — Premium Announcements Management
 * Matches ImamHadithScreen / PrayerManagementScreen palette and styling
 * No emojis · All text from i18n
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Modal, Alert, Platform, ActivityIndicator, StatusBar, Animated, Image, Switch, Dimensions } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { PermissionsAndroid } from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import Svg, { Path, Rect, Defs, LinearGradient, Stop, Circle } from "react-native-svg";
import Video from "react-native-video";
import Slider from "@react-native-community/slider";

import AudioRecord from "../lib/audioRecord";
import { getToken } from "../utils/secureStorage";
import { apiAxios, authApiFetch, buildAbsoluteUrl } from "../config/server";
import { COLORS as C, RADII, FONTS } from "../config/theme";
import { logger } from "../utils/logger";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
const STATUSBAR_HEIGHT = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;

// ─── Palette (identical source of truth as other screens) ──────────
const H = {
  bg: C.ivory,
  card: C.white,
  cardBorder: C.border,
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold: C.gold,
  goldLight: C.goldLight,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
  error: C.error,
  errorBg: C.errorBg,
  glow: C.glow,
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#053B26", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
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

const PinIcon = ({ color = H.goldDeep, size = 14 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2.5 L14 8.5 L20 9.5 L15.5 13.8 L16.8 20 L12 16.8 L7.2 20 L8.5 13.8 L4 9.5 L10 8.5 Z"
      stroke={color} strokeWidth={1.6} fill={color + "22"} strokeLinejoin="round" />
  </Svg>
);

const SpeakerIcon = ({ color = H.goldDeep, size = 13 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M5 9 H8.5 L13 5 V19 L8.5 15 H5 Z" fill={color} />
    <Path d="M16 8.5 A5 5 0 0 1 16 15.5" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
  </Svg>
);

const PersonIcon = ({ color = H.goldDeep, size = 13 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="8" r="3.4" stroke={color} strokeWidth={1.6} fill="none" />
    <Path d="M5 20 A7 7 0 0 1 19 20" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
  </Svg>
);

const MegaphoneIcon = ({ color = H.goldDeep, size = 15 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M3 10 V14 L7 15 V9 Z" fill={color} />
    <Path d="M7 9 L16 5.5 V18.5 L7 15 Z" stroke={color} strokeWidth={1.7} fill="none" strokeLinejoin="round" />
    <Path d="M16 9 A3.5 3.5 0 0 1 16 15" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    <Path d="M9 15.5 L10 20 H7.5 Z" fill={color} />
  </Svg>
);

// ─── Header Pattern (identical motif to other screens) ─────────────
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
  const lastPart = uri.split("/").pop() || "announcement.jpg";
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

const UNSUPPORTED_IMAGE_MIMES = ["image/heic", "image/heif", "image/webp", "image/gif", "image/bmp", "image/tiff"];
const UNSUPPORTED_IMAGE_EXTENSIONS = /\.(heic|heif|webp|gif|bmp|tiff?)$/i;

const isUnsupportedImage = (asset) => {
  const mime = (asset?.type || "").toLowerCase();
  if (mime && UNSUPPORTED_IMAGE_MIMES.includes(mime)) return true;
  return UNSUPPORTED_IMAGE_EXTENSIONS.test(getAssetName(asset).toLowerCase());
};

const formatRelativeTime = (isoString, t) => {
  if (!isoString) return "";
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMin = Math.max(0, Math.floor((now - then) / 60000));
  if (diffMin < 1) return t("announcements.justNow");
  if (diffMin < 60) return t("announcements.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("announcements.hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t("announcements.daysAgo", { count: diffDay });
};

// ─── Compact Header ──────────────────────────────────────────────────
const CompactHeader = ({ title, subtitle, onAdd }) => (
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
        <Text style={hs.title}>{title}</Text>
      </View>
      <AnimatedPressable onPress={onAdd} style={hs.addBtn} activeOpacity={0.85}>
        <PlusIcon />
      </AnimatedPressable>
    </View>

    <View style={hs.subRow}>
      <MegaphoneIcon color={H.goldLight} />
      <Text style={hs.subTxt}>{subtitle}</Text>
    </View>
  </View>
);

// ─── Main Component ──────────────────────────────────────────────────
export default function AnnouncementScreen() {
  const { t } = useTranslation();

  const [announcements, setAnnouncements] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
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
  const [deletingId, setDeletingId] = useState(null);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnim1 = useRef(new Animated.Value(0)).current;
  const waveAnim2 = useRef(new Animated.Value(0)).current;
  const waveAnim3 = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const modalFade = useRef(new Animated.Value(0)).current;
  const listFade = useRef(new Animated.Value(0)).current;

  const timerRef = useRef(null);
  const recordSecondsRef = useRef(0);

  const fetchAnnouncements = useCallback(async () => {
    try {
      setFetching(true);
      const res = await apiAxios({ method: "get", url: "/announcements/", params: { all: true } });
      setAnnouncements(res.data || []);
    } catch (err) {
      logger.log("ANNOUNCEMENTS FETCH ERROR:", err?.response?.data || err.message);
    } finally {
      setFetching(false);
      Animated.timing(listFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, []);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

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
  // dangling recorder / mic lock if the admin navigates away mid-recording.
  const closeModal = async () => {
    if (recordingRef.current) {
      await stopRecording();
    }
    setIsPlaying(false);
    setModalVisible(false);
  };

  const resetForm = () => {
    setTitle("");
    setBody("");
    setPinned(false);
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
      throw new Error(t("announcements.invalidImage"));
    }

    const formData = new FormData();
    formData.append("file", { uri, type: fileType, name: fileName });

    const res = await authApiFetch("/upload/image", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || t("announcements.imageUploadError"));
    return data.url;
  };

  const startRecording = async () => {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        return Alert.alert(t("announcements.permissionDeniedTitle"), t("announcements.permissionDeniedMsg"));
      }
    }
    AudioRecord.init({ sampleRate: 16000, channels: 1, bitsPerSample: 16, wavFile: "announcement.wav" });
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
    formData.append("file", { uri, type: "audio/wav", name: "announcement.wav" });

    const res = await authApiFetch("/upload/audio", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || t("announcements.audioUploadError"));
    return data.url;
  };

  // AUTO-STOP RECORDING ON POST — guarantees the mic is always released
  // and the captured clip is uploaded, even if the admin forgot to tap Stop.
  const submitAnnouncement = async () => {
    if (!title.trim() && !body.trim() && !image && !audioPath) {
      return Alert.alert(t("announcements.emptyTitle"), t("announcements.emptyMsg"));
    }
    if (!title.trim()) {
      return Alert.alert(t("announcements.missingTitleTitle"), t("announcements.missingTitleMsg"));
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
        url: "/announcements/",
        data: {
          title: title.trim(),
          body: body.trim() || null,
          pinned,
          image_url: imageUrl || null,
          audio_url: voiceUrl || null,
          target_user_id: null,
        },
        headers: await authHeader(),
      });

      Alert.alert(t("announcements.successTitle"), t("announcements.successMsg"));
      setModalVisible(false);
      resetForm();
      fetchAnnouncements();
    } catch (err) {
      logger.log("ANNOUNCEMENT POST ERROR:", err?.response?.data || err.message || err);
      Alert.alert(t("announcements.errorTitle"), err?.response?.data?.detail || err.message || t("announcements.postError"));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (item) => {
    Alert.alert(
      t("announcements.deleteConfirmTitle"),
      t("announcements.deleteConfirmMsg", { title: item.title }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("announcements.delete"), style: "destructive", onPress: () => deleteAnnouncement(item.id) },
      ]
    );
  };

  const deleteAnnouncement = async (id) => {
    try {
      setDeletingId(id);
      await apiAxios({ method: "delete", url: `/announcements/${id}`, headers: await authHeader() });
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      logger.log("ANNOUNCEMENT DELETE ERROR:", err?.response?.data || err.message);
      Alert.alert(
        t("announcements.errorTitle"),
        err?.response?.data?.detail || t("announcements.deleteError")
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <CompactHeader
        title={t("announcements.title")}
        subtitle={t("announcements.subtitle")}
        onAdd={openModal}
      />

      {fetching ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={H.headerLight} size="large" />
          <Text style={styles.loadingText}>{t("announcements.loading")}</Text>
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: listFade }}>
          <FlatList
            data={announcements}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[styles.card, item.pinned && styles.cardPinned]}>
                <View style={styles.cardTopRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      {item.pinned && (
                        <View style={styles.pinBadge}>
                          <PinIcon />
                        </View>
                      )}
                      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                    </View>
                    <Text style={styles.cardMeta}>
                      {item.posted_by} · {formatRelativeTime(item.created_at, t)}
                    </Text>
                  </View>
                  <AnimatedPressable
                    onPress={() => confirmDelete(item)}
                    style={styles.deleteBtn}
                    disabled={deletingId === item.id}
                    activeOpacity={0.75}
                  >
                    {deletingId === item.id ? (
                      <ActivityIndicator size="small" color={H.error} />
                    ) : (
                      <TrashIcon />
                    )}
                  </AnimatedPressable>
                </View>

                {!!item.body && <Text style={styles.cardBody}>{item.body}</Text>}

                {!!item.image_url && (
                  <Image source={{ uri: buildAbsoluteUrl(item.image_url) }} style={styles.cardImage} resizeMode="cover" />
                )}

                <View style={styles.cardFooter}>
                  <View style={styles.cardBadges}>
                    {!!item.image_url && (
                      <View style={styles.badge}>
                        <ImagePlusIcon color={H.goldDeep} size={12} />
                      </View>
                    )}
                    {!!item.audio_url && (
                      <View style={styles.badge}>
                        <SpeakerIcon />
                      </View>
                    )}
                    {!!item.target_user_id && (
                      <View style={styles.badge}>
                        <PersonIcon />
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MegaphoneIcon color={H.goldDeep} size={28} />
                <Text style={styles.emptyText}>{t("announcements.emptyState")}</Text>
              </View>
            }
          />
        </Animated.View>
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("announcements.modalTitle")}</Text>
            <AnimatedPressable onPress={closeModal}>
              <Text style={styles.closeBtnText}>{t("common.close")}</Text>
            </AnimatedPressable>
          </View>

          <Animated.ScrollView
            style={[styles.modalContent, { opacity: modalFade }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>{t("announcements.titleLabel")}</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={styles.input}
              placeholder={t("announcements.titlePlaceholder")}
              placeholderTextColor={H.textMuted}
              maxLength={120}
            />

            <Text style={styles.label}>{t("announcements.bodyLabel")}</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.bodyInput]}
              placeholder={t("announcements.bodyPlaceholder")}
              placeholderTextColor={H.textMuted}
            />

            <View style={styles.pinRow}>
              <View style={styles.pinLabelWrap}>
                <PinIcon color={pinned ? H.goldDeep : H.textMuted} />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={styles.pinTitle}>{t("announcements.pinLabel")}</Text>
                  <Text style={styles.pinSub}>{t("announcements.pinSub")}</Text>
                </View>
              </View>
              <Switch
                value={pinned}
                onValueChange={setPinned}
                trackColor={{ false: H.cardBorder, true: H.goldLight + "80" }}
                thumbColor={pinned ? H.gold : H.white}
                ios_backgroundColor={H.cardBorder}
              />
            </View>

            {/* ── Image preview ─────────────────────────────── */}
            {image && (
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>{t("announcements.imageLabel")}</Text>
                <AnimatedPressable
                  style={styles.imagePreviewBox}
                  activeOpacity={0.85}
                  onPress={() => setImagePreviewVisible(true)}
                >
                  <Image source={{ uri: image.uri }} style={styles.imageThumb} resizeMode="cover" />
                  <View style={styles.imagePreviewMeta}>
                    <Text style={styles.fileName} numberOfLines={1}>{getAssetName(image)}</Text>
                    <Text style={styles.tapHint}>{t("announcements.tapToView")}</Text>
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
                <Text style={styles.previewLabel}>{t("announcements.audioLabel")}</Text>
                <View style={styles.audioPreviewBox}>
                  <View style={styles.audioTopRow}>
                    <AnimatedPressable style={styles.playBtn} onPress={togglePlayback} activeOpacity={0.85}>
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </AnimatedPressable>
                    <View style={styles.audioPreviewMeta}>
                      <Text style={styles.audioPreviewTitle}>{t("announcements.voiceNote")}</Text>
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
                <Text style={styles.recordingText}>{t("announcements.recording")}</Text>
                <Text style={styles.recordingSub}>{t("announcements.recordingSub")}</Text>
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
                  {image ? t("announcements.changeImage") : t("announcements.addImage")}
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
                  {recording ? t("announcements.stop") : t("announcements.record")}
                </Text>
              </AnimatedPressable>
            </View>

            <AnimatedPressable
              style={[styles.submit, loading && styles.submitDisabled]}
              onPress={submitAnnouncement}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={H.white} />
              ) : (
                <Text style={styles.submitText}>
                  {recording ? t("announcements.stopAndPost") : t("announcements.submit")}
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

  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: H.textMuted, fontWeight: "600" },

  listContent: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: H.card,
    marginBottom: 12,
    padding: 16,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: H.cardBorder,
    ...shadow(4, 0.06),
  },
  cardPinned: {
    borderColor: H.goldLight + "70",
    backgroundColor: H.gold + "0A",
  },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pinBadge: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: H.goldLight + "25",
    justifyContent: "center", alignItems: "center",
  },
  cardTitle: { flex: 1, fontSize: 15.5, fontWeight: "700", color: H.textDark, fontFamily: FONTS.display },
  cardMeta: { fontSize: 12, color: H.textMuted, marginTop: 4 },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: H.errorBg,
    justifyContent: "center", alignItems: "center", marginLeft: 10,
  },
  cardBody: { fontSize: 14, lineHeight: 21, color: H.textDark, marginTop: 10 },
  cardImage: { width: "100%", height: 160, borderRadius: RADII.md, marginTop: 12, backgroundColor: H.cardBorder },
  cardFooter: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 10 },
  cardBadges: { flexDirection: "row", gap: 6 },
  badge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: H.goldLight + "25",
    borderWidth: 1, borderColor: H.goldLight + "50",
    justifyContent: "center", alignItems: "center",
  },
  emptyState: { alignItems: "center", marginTop: 60, gap: 10 },
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
  bodyInput: { minHeight: 120, textAlignVertical: "top" },

  pinRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: H.card, padding: 14, borderRadius: RADII.md,
    borderWidth: 1, borderColor: H.cardBorder, marginTop: 20, ...shadow(3, 0.04),
  },
  pinLabelWrap: { flexDirection: "row", alignItems: "center", flex: 1 },
  pinTitle: { fontSize: 14.5, fontWeight: "700", color: H.textDark },
  pinSub: { fontSize: 12, color: H.textMuted, marginTop: 2 },

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
    width: 32, height: 32, borderRadius: 16, backgroundColor: H.errorBg,
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
    paddingTop: STATUSBAR_HEIGHT,
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
  subRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 8 },
  subTxt: { color: "rgba(255,255,255,0.65)", fontSize: 11.5, fontWeight: "600" },
});