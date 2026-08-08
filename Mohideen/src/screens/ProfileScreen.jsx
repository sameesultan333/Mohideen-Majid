import React, { useEffect, useState, useRef, useCallback, memo } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, Animated, Platform, Dimensions, RefreshControl, Modal, FlatList, TouchableWithoutFeedback, ActivityIndicator, Alert } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getToken } from "../utils/secureStorage";
import { clearAuthSession } from "../utils/authSession";
import { changeAppLanguage } from "../localization/languages";
import { useTranslation } from "react-i18next";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import BottomNav from "../components/BottomNav";
import { apiAxios } from "../config/server";
import { COLORS as C } from "../config/theme";
import { logger } from "../utils/logger";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";
import { useTopInset } from "../hooks/useSafeArea";

// ─── Palette (exact same as HomeScreen) ─────────────────────────────
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
const BellIcon = memo(({ color = H.white, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 3 C9 3 7 5.5 7 9 L7 13 L5 16 L19 16 L17 13 L17 9 C17 5.5 15 3 12 3 Z M10 18 A2 2 0 0 0 14 18"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </Svg>
));

const CheckIcon = memo(({ color = H.white, size = 14 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 6 L9 17 L4 12" stroke={color} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const ProfileIcon = memo(({ color = H.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 12 C14 12 16 10 16 8 C16 6 14 4 12 4 C10 4 8 6 8 8 C8 10 10 12 12 12 Z M6 20 C6 16 9 14 12 14 C15 14 18 16 18 20 Z"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </Svg>
));

const LockIcon = memo(({ color = H.white, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M17 11 L7 11 L7 21 L17 21 Z M12 14 L12 17 M8 11 L8 7 C8 4.79 9.79 3 12 3 C14.21 3 16 4.79 16 7 L16 11"
      stroke={color}
      strokeWidth={1.6}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
));

const LogoutIcon = memo(({ color = H.white, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 8 L16 8 M12 2 L12 12 M4 16 L4 20 L20 20 L20 16" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const TrashIcon = memo(({ color = H.error, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M4 7 L20 7 M9 7 L9 4 L15 4 L15 7 M7 7 L7.5 20 C7.5 20.55 7.95 21 8.5 21 L15.5 21 C16.05 21 16.5 20.55 16.5 20 L17 7 M10 11 L10 17 M14 11 L14 17"
      stroke={color}
      strokeWidth={1.6}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
));

const LanguageIcon = memo(({ color = H.white, size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 2 C6.48 2 2 6.48 2 12 C2 17.52 6.48 22 12 22 C17.52 22 22 17.52 22 12 C22 6.48 17.52 2 12 2 Z M12 20 C7.58 20 4 16.42 4 12 C4 7.58 7.58 4 12 4 C16.42 4 20 7.58 20 12 C20 16.42 16.42 20 12 20 Z M8 7 L16 7 M12 7 L12 17 M8 12 L16 12"
      stroke={color}
      strokeWidth={1.6}
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
));

const QuickIcon = memo(({ type, color = H.headerDeep, size = 22 }) => {
  const paths = {
    deen: "M12 4 L4 8 L4 16 L12 20 L20 16 L20 8 L12 4 Z M12 12 L12 20 M4 8 L12 12 L20 8",
    qibla: "M12 2 L12 22 M4 12 L20 12 M12 2 L15 7 L9 7 Z",
    news: "M4 4 L20 4 L20 16 L12 20 L4 16 L4 4 Z M8 8 L16 8 M8 12 L14 12",
    donate: "M12 4 L16 8 L20 8 L18 12 L20 16 L16 16 L12 20 L8 16 L4 16 L6 12 L4 8 L8 8 Z",
    askImam: "M4 5 L20 5 L20 15 L10 15 L5 19 L5 15 L4 15 Z M9 10 L15 10",
    profile: "M12 12 C14 12 16 10 16 8 C16 6 14 4 12 4 C10 4 8 6 8 8 C8 10 10 12 12 12 Z M6 20 C6 16 9 14 12 14 C15 14 18 16 18 20 Z",
    editable: "M18 4 L20 6 L8 18 L6 18 L6 16 Z M15 7 L17 9",
    collector: "M4 6 L20 6 L20 18 L4 18 Z M4 10 L20 10 M8 14 L12 14",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={paths[type] || paths.deen} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
});

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

// ─── Language Dropdown Modal ──────────────────────────────────────────
const LanguageModal = ({ visible, onClose, currentLang, onSelect }) => {
  const { t } = useTranslation();
  const languages = [
    { code: 'en', label: 'English' },
    { code: 'ta', label: 'தமிழ்' },
  ];

  const renderItem = ({ item }) => (
    <AnimatedPressable
      style={[styles.modalItem, currentLang === item.code && styles.modalItemActive]}
      onPress={() => {
        onSelect(item.code);
        onClose();
      }}
    >
      <Text style={[styles.modalItemText, currentLang === item.code && styles.modalItemTextActive]}>
        {item.label}
      </Text>
      {currentLang === item.code && (
        <View style={styles.modalCheck}>
          <CheckIcon color={H.gold} size={18} />
        </View>
      )}
    </AnimatedPressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContent}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t('profile.selectLanguage')}</Text>
              <FlatList
                data={languages}
                renderItem={renderItem}
                keyExtractor={(item) => item.code}
                contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// ─── Header Component ──────────────────────────────────────────────
const CompactHeader = ({ userName, greetingKey, hijriDate, gregorianDate, unreadCount, onBellPress }) => {
  const topInset = useTopInset();
  const initial = (userName || "U").trim().charAt(0).toUpperCase();
  return (
    <View style={[hs.wrap, { height: 148 + topInset, paddingTop: topInset }]}>
      <Svg width={SW} height={148 + topInset} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset={0} stopColor={H.headerDeep} />
            <Stop offset={1} stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={148 + topInset} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={148} />

      <View style={hs.row}>
        <View style={hs.avatar}>
          <Text allowFontScaling={false} style={hs.avatarTxt}>{initial}</Text>
        </View>
        <View style={hs.mid}>
          <Text allowFontScaling={false} style={hs.greeting}>{greetingKey}</Text>
          <Text allowFontScaling={false} style={hs.name} numberOfLines={1}>{userName || "User"}</Text>
        </View>
        <AnimatedPressable accessibilityLabel="Notifications" onPress={onBellPress} style={hs.bell}>
          <BellIcon />
          {unreadCount > 0 && (
            <View style={hs.badge}>
              <Text allowFontScaling={false} style={hs.badgeTxt}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </AnimatedPressable>
      </View>

      <View style={hs.dateRow}>
        <Text allowFontScaling={false} style={hs.dateTxt}>{gregorianDate}</Text>
        <View style={hs.dateDot} />
        <Text allowFontScaling={false} style={hs.dateTxt}>{hijriDate}</Text>
      </View>
    </View>
  );
};

// ─── Main Component ──────────────────────────────────────────────────
export default function ProfileScreen({ navigation, route }) {
  const currentRoute = route?.name || "Profile";
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language;

  const [user, setUser] = useState({ name: "", phone: "", role: "", address: "" });
  const [chandaNumber, setChandaNumber] = useState("");
  const [headAddress, setHeadAddress] = useState("");
  const [familyMembers, setFamilyMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(40)).current;
  const scale = useRef(new Animated.Value(0.95)).current;

  // ─── Animations ────────────────────────────────────────────────────
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 600, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  // ─── Clock update ─────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  // ─── Load user data ──────────────────────────────────────────────
  const loadUser = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);

      const data = await AsyncStorage.getItem("user");
      if (!data) { setLoading(false); return; }
      const userData = JSON.parse(data);
      setUser({
        ...userData,
        address: userData.address || "",
        chanda_no: userData.chanda_no || "",
      });
      setChandaNumber(userData.chanda_no || "");

      const token = await getToken();
      if (!token) { setLoading(false); return; }

      // Fetch family info from the user-specific endpoint (no admin required)
      try {
        const familyRes = await apiAxios({
          method: "get",
          url: "/user/family",
          headers: { Authorization: `Bearer ${token}` },
        });
        const family = familyRes.data || {};
        if (family.chanda_no) {
          setChandaNumber(family.chanda_no);
          setUser((prev) => ({ ...prev, chanda_no: family.chanda_no }));
        }
        if (family.address) {
          setHeadAddress(family.address);
          setUser((prev) => ({ ...prev, address: family.address }));
        }
        if (family.members?.length > 0) {
          setFamilyMembers(family.members);
        }
      } catch (_) {
        // silently ignore if family info unavailable
      }

      // Fetch unread announcements count (for bell badge)
      try {
        const annRes = await apiAxios({
          method: "get",
          url: "/announcements/",
          headers: { Authorization: `Bearer ${token}` },
        });
        const announcements = annRes.data || [];
        const seen = JSON.parse(await AsyncStorage.getItem("seen_announcements") || "[]");
        const unread = announcements.filter((a) => !seen.includes(a.id)).length;
        setUnreadCount(unread);
      } catch (e) {
        // ignore
      }
    } catch (e) {
      logger.log("Profile load error", e);
    } finally {
      setLoading(false);
      if (showRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // ─── Handlers ─────────────────────────────────────────────────────
  const onRefresh = () => loadUser(true);

  const doLogout = async () => {
    await clearAuthSession();
    navigation.replace("Login");
  };

  const handleLogout = () => {
    Alert.alert(
      t("profile.logoutTitle"),
      t("profile.logoutMessage"),
      [
        { text: t("profile.logoutCancel"), style: "cancel" },
        { text: t("profile.logoutConfirm"), style: "destructive", onPress: doLogout },
      ],
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t("profile.deleteAccountWarningTitle"),
      t("profile.deleteAccountWarningMessage"),
      [
        { text: t("profile.deleteAccountCancel"), style: "cancel" },
        { text: t("profile.deleteAccountConfirm"), style: "destructive", onPress: () => navigation.navigate("DeleteAccount") },
      ],
    );
  };

  const toggleLanguage = (lang) => {
    changeAppLanguage(lang);
  };

  const getInitials = (name) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  const displayAddress = headAddress || user.address;
  const displayChandaNumber = chandaNumber || user.chanda_no || "—";
  const greeting = (() => {
    const hour = currentTime.getHours();
    if (hour < 12) return t("greeting.morning");
    if (hour < 17) return t("greeting.afternoon");
    return t("greeting.evening");
  })();

  const hijriDate = getHijriDateString(currentTime);
  const gregorianDate = currentTime.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // ─── Render Family Member ──────────────────────────────────────────
  const renderFamilyItem = ({ item }) => {
    return (
      <View style={styles.familyItem}>
        <View style={styles.familyAvatar}>
          <Text style={styles.familyAvatarText}>{getInitials(item.name)}</Text>
        </View>
        <View style={styles.familyInfo}>
          <Text style={styles.familyName}>{item.name}</Text>
          <Text style={styles.familyPhone}>{item.phone}</Text>
        </View>
        {item.role && (
          <View style={styles.familyRoleBadge}>
            <Text style={styles.familyRoleText}>{item.role}</Text>
          </View>
        )}
      </View>
    );
  };

  // ─── Loading state ──────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />
        <ActivityIndicator size="large" color={H.gold} />
        <Text style={styles.loadingText}>{t("common.loading")}</Text>
        <BottomNav navigation={navigation} currentRoute={currentRoute} />
      </View>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={H.headerDeep} />

      <Animated.ScrollView
        style={{ flex: 1, opacity: fade, transform: [{ translateY: translate }, { scale: scale }] }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} />
        }
      >
        <CompactHeader
          userName={user.name}
          greetingKey={greeting}
          hijriDate={hijriDate}
          gregorianDate={gregorianDate}
          unreadCount={unreadCount}
          onBellPress={() => navigation.navigate("Announcement")}
        />

        {/* Profile Card */}
        <View style={styles.section}>
          <View style={styles.profileCard}>
            <View style={styles.avatarWrapper}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(user.name)}</Text>
              </View>
            </View>
            <Text style={styles.name}>{user.name || t("profile.member")}</Text>
            <Text style={styles.role}>{user.role || t("profile.member")}</Text>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t("profile.chanda_number")}</Text>
              <Text style={styles.detailValue}>{displayChandaNumber}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t("profile.address")}</Text>
              <Text style={styles.detailValue}>{displayAddress || "—"}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t("profile.phone")}</Text>
              <Text style={styles.detailValue}>{user.phone || "—"}</Text>
            </View>
          </View>
        </View>

        {/* Family Members */}
        {familyMembers.length > 0 && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t("profile.family_members")}</Text>
              <FlatList
                data={familyMembers}
                renderItem={renderFamilyItem}
                keyExtractor={(item, index) => item.phone || index.toString()}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            </View>
          </View>
        )}

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("profile.settings")}</Text>
          <View style={styles.card}>
            <AnimatedPressable style={styles.action} onPress={() => setModalVisible(true)}>
              <View style={styles.actionLeft}>
                <LanguageIcon color={H.headerDeep} size={22} />
                <Text style={styles.actionText}>{t("profile.language")}</Text>
              </View>
              <Text style={styles.actionValue}>{currentLanguage === "en" ? "English" : "தமிழ்"}</Text>
            </AnimatedPressable>
            <View style={styles.separator} />
            <AnimatedPressable style={styles.action} onPress={() => navigation.navigate("Chanda")}>
              <View style={styles.actionLeft}>
                <ProfileIcon color={H.headerDeep} size={22} />
                <Text style={styles.actionText}>{t("profile.chanda_history")}</Text>
              </View>
            </AnimatedPressable>
            <View style={styles.separator} />
            <AnimatedPressable style={styles.action} onPress={() => alert(t("profile.about_app"))}>
              <View style={styles.actionLeft}>
                <QuickIcon type="deen" color={H.headerDeep} size={22} />
                <Text style={styles.actionText}>{t("profile.about_app")}</Text>
              </View>
            </AnimatedPressable>
          </View>
        </View>

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("profile.account")}</Text>
          <View style={styles.card}>
            <AnimatedPressable style={styles.action} onPress={() => navigation.navigate("ChangePassword")} activeOpacity={0.75}>
              <View style={styles.actionLeft}>
                <LockIcon color={H.headerDeep} size={22} />
                <Text style={styles.actionText}>Change Password</Text>
              </View>
            </AnimatedPressable>
            <View style={styles.separator} />
            <AnimatedPressable style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.75}>
              <LogoutIcon color={H.error} size={20} />
              <Text style={styles.logoutText}>{t("profile.logout")}</Text>
            </AnimatedPressable>
            {user.role !== "superadmin" && (
              <>
                <View style={{ height: 10 }} />
                <AnimatedPressable style={styles.logoutRow} onPress={handleDeleteAccount} activeOpacity={0.75}>
                  <TrashIcon color={H.error} size={18} />
                  <Text style={styles.logoutText}>{t("profile.deleteAccount")}</Text>
                </AnimatedPressable>
              </>
            )}
          </View>
        </View>

        <View style={{ height: 20 }} />
      </Animated.ScrollView>

      {/* Language Modal */}
      <LanguageModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        currentLang={currentLanguage}
        onSelect={toggleLanguage}
      />

      <BottomNav navigation={navigation} currentRoute={currentRoute} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: H.bg },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: H.bg, paddingBottom: 80 },
  loadingText: { color: H.textMuted, fontSize: 14, fontWeight: "500", marginTop: 16 },
  scrollContent: { paddingBottom: 40 },

  section: { marginHorizontal: 16, marginTop: 20 },

  profileCard: {
    backgroundColor: H.card,
    borderRadius: 22,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: H.cardBorder,
    ...shadow(6, 0.08),
  },
  avatarWrapper: {
    borderWidth: 2,
    borderColor: H.gold,
    borderRadius: 50,
    padding: 4,
    marginBottom: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: H.gold,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: 26, fontWeight: "700", color: H.white },
  name: { fontSize: 20, fontWeight: "700", color: H.textDark, fontFamily: "Georgia" },
  role: { fontSize: 13, color: H.textMuted, marginTop: 2, textTransform: "capitalize" },
  divider: { width: "100%", height: 1, backgroundColor: H.cardBorder, marginVertical: 14 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 6,
  },
  detailLabel: { fontSize: 12, color: H.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  detailValue: { fontSize: 14, fontWeight: "600", color: H.textDark, textAlign: "right", flex: 1, marginLeft: 12 },

  card: {
    backgroundColor: H.card,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: H.cardBorder,
    ...shadow(4, 0.06),
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: H.textDark,
    marginBottom: 12,
    fontFamily: "Georgia",
  },

  familyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  familyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: H.goldLight + "30",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  familyAvatarText: { fontSize: 16, fontWeight: "700", color: H.goldDeep },
  familyInfo: { flex: 1 },
  familyName: { fontSize: 14, fontWeight: "600", color: H.textDark },
  familyPhone: { fontSize: 12, color: H.textMuted },
  familyRoleBadge: {
    backgroundColor: H.goldLight + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: H.goldDeep,
  },
  familyRoleText: { fontSize: 10, fontWeight: "600", color: H.goldDeep, textTransform: "capitalize" },

  separator: { height: 1, backgroundColor: H.cardBorder, marginVertical: 4 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: H.textMuted,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },

  action: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  actionLeft: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  actionText: { fontSize: 14, fontWeight: "600", color: H.textDark, marginLeft: 12 },
  actionValue: { fontSize: 14, fontWeight: "600", color: H.goldDeep },

  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: H.error,
    backgroundColor: "rgba(192,71,58,0.04)",
    gap: 10,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "700",
    color: H.error,
    letterSpacing: 0.2,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: H.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "60%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: H.cardBorder,
    alignSelf: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: H.textDark,
    textAlign: "center",
    marginBottom: 16,
    fontFamily: "Georgia",
  },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: H.cardBorder,
  },
  modalItemActive: { backgroundColor: H.goldLight + "10" },
  modalItemText: { fontSize: 16, color: H.textDark, fontWeight: "500" },
  modalItemTextActive: { color: H.goldDeep, fontWeight: "700" },
  modalCheck: { marginLeft: 12 },
});

// ─── Header Styles ────────────────────────────────────────────────────
const hs = StyleSheet.create({
  wrap: { height: 148, paddingHorizontal: 20, overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1.5, borderColor: H.goldLight, alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { color: H.white, fontSize: 16, fontWeight: "700" },
  mid: { flex: 1, marginLeft: 12 },
  greeting: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "600" },
  name: { color: H.white, fontSize: 16, fontWeight: "700", marginTop: 1 },
  bell: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: -3, right: -3, backgroundColor: H.error, borderRadius: 9,
    minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: H.headerDeep,
  },
  badgeTxt: { color: H.white, fontSize: 8, fontWeight: "900" },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: 12, marginRight: 8 },
  dateTxt: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600", marginRight: 8 },
  dateDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: H.goldLight, marginRight: 8 },
});