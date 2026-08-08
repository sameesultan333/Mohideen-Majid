// screens/CashSubmissionScreen.jsx
import React, { useState, useCallback, useEffect, memo, useMemo, useRef } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, Alert, ActivityIndicator, SafeAreaView, StatusBar, Modal, FlatList, Animated, Dimensions, Platform } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import { useTranslation } from "react-i18next";
import { authApiFetch } from "../config/server";
import { COLORS as C, RADII, FONTS, SPACING } from "../config/theme";
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import SafeModal from "../components/SafeModal";

const { width: SW } = Dimensions.get("window");
const IOS = Platform.OS === "ios";

// ─── SVG Icons ──────────────────────────────────────────────────────
const ChevronLeftIcon = memo(({ color = C.white, size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18 L9 12 L15 6" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const CheckIcon = memo(({ color = C.white, size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M5 12 L10 17 L19 8" stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const CloseIcon = memo(({ color = C.textMuted, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M18 6 L6 18 M6 6 L18 18" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
  </Svg>
));

// ─── Header Pattern ──────────────────────────────────────────────
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
        <Path key={i} d={d} fill={C.gold} opacity={0.06} />
      ))}
    </Svg>
  );
});

// ─── Premium Header ────────────────────────────────────────────────
const PremiumHeader = memo(({ title, onBack }) => (
  <View style={headerStyles.wrap}>
    <Svg width={SW} height={148} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={C.bg} />
          <Stop offset="1" stopColor={C.bgVivid} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={SW} height={148} fill="url(#headerGrad)" />
    </Svg>
    <HeaderPattern w={SW} h={148} />
    <View style={headerStyles.content}>
      <AnimatedPressable onPress={onBack} style={headerStyles.backBtn} activeOpacity={0.7}>
        <ChevronLeftIcon color={C.white} size={24} />
      </AnimatedPressable>
      <Text style={headerStyles.title}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  </View>
));

const headerStyles = StyleSheet.create({
  wrap: {
    height: 136,
    paddingHorizontal: 20,
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingTop: 18,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.white,
    fontFamily: FONTS.display,
    letterSpacing: 0.5,
  },
});

// ─── Pure-JS date picker ──────────────────────────────────────────
function DatePickerModal({ visible, value, onConfirm, onCancel }) {
  const [day, setDay] = useState(String(value.getDate()));
  const [month, setMonth] = useState(String(value.getMonth() + 1));
  const [year, setYear] = useState(String(value.getFullYear()));

  useEffect(() => {
    setDay(String(value.getDate()));
    setMonth(String(value.getMonth() + 1));
    setYear(String(value.getFullYear()));
  }, [value]);

  const confirm = () => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) {
      Alert.alert("Invalid date", "Please enter a valid day, month, and year.");
      return;
    }
    onConfirm(new Date(y, m - 1, d));
  };

  return (
    <SafeModal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <AnimatedPressable style={dpStyles.overlay} activeOpacity={1} onPress={onCancel}>
        <AnimatedPressable activeOpacity={1} style={dpStyles.card}>
          <Text style={dpStyles.title}>Select Date</Text>
          <View style={dpStyles.row}>
            <View style={dpStyles.field}>
              <Text style={dpStyles.label}>DD</Text>
              <TextInput style={dpStyles.input} value={day} onChangeText={setDay}
                keyboardType="numeric" maxLength={2} selectTextOnFocus />
            </View>
            <Text style={dpStyles.sep}>/</Text>
            <View style={dpStyles.field}>
              <Text style={dpStyles.label}>MM</Text>
              <TextInput style={dpStyles.input} value={month} onChangeText={setMonth}
                keyboardType="numeric" maxLength={2} selectTextOnFocus />
            </View>
            <Text style={dpStyles.sep}>/</Text>
            <View style={[dpStyles.field, { flex: 1.4 }]}>
              <Text style={dpStyles.label}>YYYY</Text>
              <TextInput style={dpStyles.input} value={year} onChangeText={setYear}
                keyboardType="numeric" maxLength={4} selectTextOnFocus />
            </View>
          </View>
          <View style={dpStyles.btnRow}>
            <AnimatedPressable style={dpStyles.cancelBtn} onPress={onCancel}>
              <Text style={dpStyles.cancelTxt}>Cancel</Text>
            </AnimatedPressable>
            <AnimatedPressable style={dpStyles.confirmBtn} onPress={confirm}>
              <Text style={dpStyles.confirmTxt}>Confirm</Text>
            </AnimatedPressable>
          </View>
        </AnimatedPressable>
      </AnimatedPressable>
    </SafeModal>
  );
}

const dpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: C.white,
    borderRadius: RADII.xl,
    padding: 24,
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textDark,
    marginBottom: 16,
    textAlign: "center",
    fontFamily: FONTS.display,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 6,
    marginBottom: 20,
  },
  field: { flex: 1, alignItems: "center" },
  label: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: RADII.sm,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 18,
    fontWeight: "700",
    color: C.textDark,
    textAlign: "center",
    width: "100%",
  },
  sep: {
    fontSize: 22,
    color: C.textMuted,
    fontWeight: "700",
    paddingBottom: 6,
  },
  btnRow: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
  },
  cancelTxt: { color: C.textMuted, fontWeight: "600", fontSize: 14 },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADII.sm,
    backgroundColor: C.bgVivid,
    alignItems: "center",
  },
  confirmTxt: { color: C.white, fontWeight: "700", fontSize: 14 },
});

// ─── Helpers ──────────────────────────────────────────────────────────
const fmt = (d) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";
const fmtShort = (d) =>
  d ? `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}` : "";
const money = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? "0" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

// ─── Category options using translation keys ──────────────────────
const CATEGORY_OPTIONS = [
  { key: "chanda", labelKey: "cashSubmission.monthlyChanda" },
  { key: "donation", labelKey: "cashSubmission.donationsFunds" },
];

// ─── Premium sub-components ──────────────────────────────────────────
const SectionLabel = memo(({ label }) => (
  <Text style={styles.sectionLabel}>{label}</Text>
));

const CategoryRow = memo(({ option, checked, onToggle, t }) => (
  <AnimatedPressable
    style={[styles.categoryRow, checked && styles.categoryRowActive]}
    onPress={onToggle}
    activeOpacity={0.7}
  >
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked && <CheckIcon color={C.white} size={14} />}
    </View>
    <Text style={[styles.categoryLabel, checked && styles.categoryLabelActive]}>
      {t(option.labelKey)}
    </Text>
  </AnimatedPressable>
));

const DateRow = memo(({ label, date, onPress }) => (
  <AnimatedPressable style={styles.dateRow} onPress={onPress} activeOpacity={0.7}>
    <Text style={styles.dateLabel}>{label}</Text>
    <Text style={styles.dateValue}>{fmt(date)}</Text>
  </AnimatedPressable>
));

const BreakdownRow = memo(({ label, value, isTotal = false }) => (
  <View style={[styles.breakdownRow, isTotal && styles.totalRow]}>
    <Text style={[styles.breakdownLabel, isTotal && styles.totalLabel]}>
      {label}
    </Text>
    <Text style={[styles.breakdownValue, isTotal && styles.totalValue]}>
      ₹{value}
    </Text>
  </View>
));

// ─── Main Screen ──────────────────────────────────────────────────────
export default function CashSubmissionScreen({ navigation }) {
  const { t } = useTranslation();

  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);

  const [categories, setCategories] = useState(CATEGORY_OPTIONS.map((c) => c.key));

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [showTransactions, setShowTransactions] = useState(false);

  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [showAdminPicker, setShowAdminPicker] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 7, useNativeDriver: true }),
    ]).start();
  }, []);

  // ─── Fetch admins ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/collector/admins");
        if (!res.ok) return;
        const data = await res.json();
        setAdmins(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      } finally {
        setAdminsLoading(false);
      }
    })();
  }, []);

  // ─── Load preview ──────────────────────────────────────────────────
  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const qs = categories.map((c) => `categories=${encodeURIComponent(c)}`).join("&");
      const res = await authApiFetch(`/collector/cash-submissions/preview?${qs}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPreview(data);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [categories]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // ─── Toggle category ──────────────────────────────────────────────
  const toggleCategory = useCallback((key) => {
    setCategories((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  }, []);

  // ─── Submit ────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (categories.length === 0) {
      Alert.alert(t("cashSubmission.error"), "Select at least one category.");
      return;
    }
    if (!preview || preview.transaction_count === 0) {
      Alert.alert(t("cashSubmission.error"), "No collections found for the selected categories.");
      return;
    }
    if (endDate < startDate) {
      Alert.alert(t("cashSubmission.error"), t("cashSubmission.dateError"));
      return;
    }
    setLoading(true);
    try {
      const res = await authApiFetch("/collector/cash-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          categories,
          notes: notes.trim() || null,
          receiving_admin_id: selectedAdmin?.id ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || t("common.error"));
      }
      Alert.alert(
        t("cashSubmission.success"),
        t("cashSubmission.successMsg"),
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert(t("cashSubmission.error"), err?.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, categories, preview, notes, selectedAdmin, navigation, t]);

  const canSubmit = !previewLoading && preview && preview.transaction_count > 0 && categories.length > 0;

  // ─── Memoized derived values ──────────────────────────────────────
  const totalAmount = useMemo(() => preview?.total_amount || 0, [preview]);
  const cashAmount = useMemo(() => preview?.cash_amount || 0, [preview]);
  const onlineAmount = useMemo(() => preview?.online_amount || 0, [preview]);
  const txnCount = useMemo(() => preview?.transaction_count || 0, [preview]);

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>

      <PremiumHeader title={t("cashSubmission.title")} onBack={() => navigation.goBack()} />

      <Animated.ScrollView
        style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Submitted To ─────────────────────────────────────────────── */}
        <SectionLabel label={t("cashSubmission.submittedTo")} />
        <AnimatedPressable
          style={styles.dropdownBtn}
          onPress={() => setShowAdminPicker(true)}
          disabled={adminsLoading}
          activeOpacity={0.8}
        >
          {adminsLoading ? (
            <ActivityIndicator size="small" color={C.gold} />
          ) : (
            <>
              <Text style={[styles.dropdownVal, !selectedAdmin && styles.dropdownPlaceholder]}>
                {selectedAdmin ? selectedAdmin.name : t("cashSubmission.selectAdmin")}
              </Text>
              <Text style={styles.dropdownChevron}>▼</Text>
            </>
          )}
        </AnimatedPressable>

        {/* ── Period ───────────────────────────────────────────────────── */}
        <SectionLabel label={t("cashSubmission.collectionPeriod")} />
        <DateRow
          label={t("cashSubmission.startDate")}
          date={startDate}
          onPress={() => setShowStart(true)}
        />
        <DateRow
          label={t("cashSubmission.endDate")}
          date={endDate}
          onPress={() => setShowEnd(true)}
        />

        <DatePickerModal
          visible={showStart}
          value={startDate}
          onConfirm={(d) => { setStartDate(d); setShowStart(false); }}
          onCancel={() => setShowStart(false)}
        />
        <DatePickerModal
          visible={showEnd}
          value={endDate}
          onConfirm={(d) => { setEndDate(d); setShowEnd(false); }}
          onCancel={() => setShowEnd(false)}
        />

        {/* ── Categories ───────────────────────────────────────────────── */}
        <SectionLabel label={t("cashSubmission.collectionsIncluded")} />
        {CATEGORY_OPTIONS.map((opt) => (
          <CategoryRow
            key={opt.key}
            option={opt}
            checked={categories.includes(opt.key)}
            onToggle={() => toggleCategory(opt.key)}
            t={t}
          />
        ))}

        {/* ── Breakdown ────────────────────────────────────────────────── */}
        <SectionLabel label={t("cashSubmission.collectionSummary")} />
        {previewLoading ? (
          <View style={styles.breakdownCard}>
            <ActivityIndicator color={C.gold} />
          </View>
        ) : (
          <View style={styles.breakdownCard}>
            <BreakdownRow label={t("cashSubmission.cashCollected")} value={money(cashAmount)} />
            <BreakdownRow label={t("cashSubmission.onlineUPI")} value={money(onlineAmount)} />
            <View style={styles.divider} />
            <BreakdownRow label={t("cashSubmission.totalCollection")} value={money(totalAmount)} isTotal />

            <AnimatedPressable
              style={styles.viewTxnBtn}
              onPress={() => setShowTransactions(true)}
              disabled={txnCount === 0}
              activeOpacity={0.7}
            >
              <Text style={styles.viewTxnTxt}>
                {t("cashSubmission.viewTransactions", { count: txnCount })}
              </Text>
            </AnimatedPressable>
          </View>
        )}

        {/* ── Notes ────────────────────────────────────────────────────── */}
        <SectionLabel label={t("cashSubmission.notesLabel")} />
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          placeholder={t("cashSubmission.notesPlaceholder")}
          placeholderTextColor={C.textMuted}
        />

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>{t("cashSubmission.lockWarning")}</Text>
        </View>

        <AnimatedPressable
          style={[styles.submitBtn, (!loading && canSubmit) ? styles.submitActive : styles.submitDisabled]}
          onPress={submit}
          disabled={loading || !canSubmit}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={styles.submitTxt}>Submit for Approval</Text>
          )}
        </AnimatedPressable>
      </Animated.ScrollView>

      {/* ── Admin picker modal ────────────────────────────────────────── */}
      <SafeModal visible={showAdminPicker} transparent animationType="fade" onRequestClose={() => setShowAdminPicker(false)}>
        <AnimatedPressable style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAdminPicker(false)}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Admin</Text>
              <AnimatedPressable onPress={() => setShowAdminPicker(false)}>
                <CloseIcon color={C.textMuted} size={20} />
              </AnimatedPressable>
            </View>
            {admins.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={{ color: C.textMuted, fontSize: 14 }}>No admins found</Text>
              </View>
            ) : (
              <FlatList
                data={admins}
                keyExtractor={(a) => String(a.id)}
                style={{ maxHeight: 340 }}
                renderItem={({ item }) => (
                  <AnimatedPressable
                    style={[styles.adminRow, selectedAdmin?.id === item.id && styles.adminRowActive]}
                    onPress={() => { setSelectedAdmin(item); setShowAdminPicker(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.adminRowTxt, selectedAdmin?.id === item.id && styles.adminRowTxtActive]}>
                      {item.name}
                    </Text>
                    {selectedAdmin?.id === item.id && (
                      <CheckIcon color={C.bgVivid} size={16} />
                    )}
                  </AnimatedPressable>
                )}
              />
            )}
          </View>
        </AnimatedPressable>
      </SafeModal>

      {/* ── Transactions detail modal ─────────────────────────────────── */}
      <SafeModal visible={showTransactions} transparent animationType="fade" onRequestClose={() => setShowTransactions(false)}>
        <AnimatedPressable style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowTransactions(false)}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transactions</Text>
              <AnimatedPressable onPress={() => setShowTransactions(false)}>
                <CloseIcon color={C.textMuted} size={20} />
              </AnimatedPressable>
            </View>
            <FlatList
              data={preview?.transactions || []}
              keyExtractor={(item) => `${item.type}-${item.id}`}
              style={{ maxHeight: 420 }}
              renderItem={({ item }) => (
                <View style={styles.txnRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnName}>{item.head_name || "—"}</Text>
                    <Text style={styles.txnMeta}>
                      {item.type === "chanda" ? "Chanda" : "Donation"} · {item.method?.toUpperCase()} ·{" "}
                      {item.date ? fmtShort(new Date(item.date)) : ""}
                    </Text>
                  </View>
                  <Text style={styles.txnAmount}>₹{money(item.amount)}</Text>
                </View>
              )}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={{ color: C.textMuted, fontSize: 14 }}>No transactions</Text>
                </View>
              }
            />
          </View>
        </AnimatedPressable>
      </SafeModal>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  scrollContent: { padding: SPACING.lg, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },

  // Dropdown
  dropdownBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.white,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    minHeight: 50,
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  dropdownVal: { fontSize: 14, fontWeight: "600", color: C.textDark, flex: 1 },
  dropdownPlaceholder: { color: C.textMuted, fontWeight: "400" },
  dropdownChevron: { fontSize: 11, color: C.textMuted, marginLeft: 8 },

  // Date rows
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: C.white,
    borderRadius: RADII.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: SPACING.sm,
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  dateLabel: { fontSize: 14, color: C.textDark },
  dateValue: { fontSize: 14, fontWeight: "600", color: C.bgVivid },

  // Categories
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.white,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  categoryRowActive: {
    borderColor: C.gold,
    backgroundColor: C.gold + "08",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: C.bgVivid,
    borderColor: C.bgVivid,
  },
  categoryLabel: { fontSize: 14, color: C.textDark, fontWeight: "500" },
  categoryLabelActive: { color: C.bgVivid, fontWeight: "700" },

  // Breakdown
  breakdownCard: {
    backgroundColor: C.white,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: SPACING.md,
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  totalRow: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 4,
  },
  breakdownLabel: { fontSize: 14, color: C.textMuted },
  totalLabel: { fontSize: 13, fontWeight: "800", color: C.textDark, letterSpacing: 0.5 },
  breakdownValue: { fontSize: 14, fontWeight: "700", color: C.textDark },
  totalValue: { fontSize: 20, fontWeight: "800", color: C.bgVivid },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
  viewTxnBtn: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: C.bgVivid,
    backgroundColor: C.bgVivid + "08",
  },
  viewTxnTxt: { color: C.bgVivid, fontWeight: "700", fontSize: 13 },

  // Notes
  notesInput: {
    backgroundColor: C.white,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: SPACING.md,
    fontSize: 14,
    color: C.textDark,
    minHeight: 80,
    textAlignVertical: "top",
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  infoBox: {
    backgroundColor: C.gold + "15",
    borderRadius: RADII.sm,
    padding: SPACING.md,
    marginTop: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: C.gold,
  },
  infoText: { fontSize: 13, color: C.goldDeep, lineHeight: 18 },

  submitBtn: {
    borderRadius: RADII.md,
    padding: 16,
    alignItems: "center",
    marginTop: SPACING.xl,
    marginBottom: 20,
  },
  submitActive: { backgroundColor: C.bgVivid },
  submitDisabled: { backgroundColor: C.textMuted + "40" },
  submitTxt: { color: C.white, fontSize: 16, fontWeight: "700" },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: C.white,
    borderRadius: RADII.xl,
    overflow: "hidden",
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 15, fontWeight: "800", color: C.textDark, fontFamily: FONTS.display },
  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border + "30",
  },
  adminRowActive: { backgroundColor: C.bgVivid + "08" },
  adminRowTxt: { fontSize: 14, color: C.textDark, flex: 1 },
  adminRowTxtActive: { fontWeight: "700", color: C.bgVivid },
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.border + "30",
  },
  txnName: { fontSize: 14, fontWeight: "600", color: C.textDark },
  txnMeta: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  txnAmount: { fontSize: 14, fontWeight: "700", color: C.bgVivid, marginLeft: 12 },
});