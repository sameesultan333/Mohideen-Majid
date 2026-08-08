/**

 * PrayerManagementScreen — Premium Prayer Timings Management

 * Matches ImamHadithScreen / AskQuestionScreen palette and styling

 * No emojis · All text from i18n · Custom JS-only time picker (no native
 * module — @react-native-community/datetimepicker was never linked into
 * this build and crashed with "RNCDatePicker could not be found").

 */



import React, { useEffect, useRef, useState, useCallback } from "react";

import { View, Text, StyleSheet, TextInput, ActivityIndicator, StatusBar, Platform, Animated, Dimensions, Alert, Modal, KeyboardAvoidingView } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";

import { useTranslation } from "react-i18next";

import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop } from "react-native-svg";



import { apiAxios, authApiAxios } from "../config/server";

import { COLORS as C, RADII, SPACING, FONTS } from "../config/theme";
import { logger } from "../utils/logger";



const { width: SW } = Dimensions.get("window");

const IOS = Platform.OS === "ios";




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



const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;



// ─── SVG Icons (no emojis) ───────────────────────────────────────────

const ClockIcon = ({ color = H.goldDeep, size = 16 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.8} fill="none" />

    <Path d="M12 7 V12 L15.5 14" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />

  </Svg>

);



const ChevronIcon = ({ color = H.textMuted, size = 16 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Path d="M9 6 L15 12 L9 18" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />

  </Svg>

);



const SunIcon = ({ color = H.goldDeep, size = 15 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Circle cx="12" cy="12" r="4.2" stroke={color} strokeWidth={1.8} fill="none" />

    <Path

      d="M12 2.5 V5 M12 19 V21.5 M4.2 4.2 L6 6 M18 18 L19.8 19.8 M2.5 12 H5 M19 12 H21.5 M4.2 19.8 L6 18 M18 6 L19.8 4.2"

      stroke={color} strokeWidth={1.8} strokeLinecap="round"

    />

  </Svg>

);



const MoonIcon = ({ color = H.goldDeep, size = 15 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Path

      d="M20 13.5 A8 8 0 1 1 10.5 4 A6.4 6.4 0 0 0 20 13.5 Z"

      stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round"

    />

  </Svg>

);



const StarIcon = ({ color = H.goldDeep, size = 15 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Path d="M12 3 L14.2 9.4 L21 10 L15.8 14.2 L17.5 21 L12 17.2 L6.5 21 L8.2 14.2 L3 10 L9.8 9.4 Z" stroke={color} strokeWidth={1.6} fill="none" strokeLinejoin="round" />

  </Svg>

);



const NoteIcon = ({ color = H.goldDeep, size = 15 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Path d="M6 3.5 H15 L18.5 7 V20.5 H6 Z" stroke={color} strokeWidth={1.7} fill="none" strokeLinejoin="round" />

    <Path d="M15 3.5 V7 H18.5" stroke={color} strokeWidth={1.7} fill="none" strokeLinejoin="round" />

    <Path d="M8.5 12 H16 M8.5 15.5 H14" stroke={color} strokeWidth={1.5} strokeLinecap="round" />

  </Svg>

);



const SaveIcon = ({ color = H.white, size = 18 }) => (

  <Svg width={size} height={size} viewBox="0 0 24 24">

    <Path d="M5 4.5 H16.5 L19.5 7.5 V19.5 H5 Z" stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />

    <Path d="M8 4.5 V9.5 H15.5 V4.5" stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />

    <Rect x="8" y="13" width="8" height="5" stroke={color} strokeWidth={1.8} fill="none" />

  </Svg>

);



const InfoDotIcon = ({ color = H.goldLight, size = 6 }) => (

  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />

);



// ─── Header pattern (identical motif to other screens) ──────────────

const HeaderPattern = ({ w = SW, h = 152 }) => {

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



// ─── Helpers: "HH:MM" string ↔ Date ──────────────────────────────────

const timeStringToDate = (value) => {

  const base = new Date();

  base.setSeconds(0, 0);

  if (value && TIME_RE.test(value)) {

    const [h, m] = value.split(":").map(Number);

    base.setHours(h, m, 0, 0);

  } else {

    base.setHours(5, 0, 0, 0); // sensible default when field is empty

  }

  return base;

};



const dateToTimeString = (date) => {

  const h = date.getHours().toString().padStart(2, "0");

  const m = date.getMinutes().toString().padStart(2, "0");

  return `${h}:${m}`;

};



const formatDisplayTime = (value) => {

  if (!value || !TIME_RE.test(value)) return null;

  const [h, m] = value.split(":").map(Number);

  const period = h >= 12 ? "PM" : "AM";

  const h12 = h % 12 === 0 ? 12 : h % 12;

  return `${h12.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} ${period}`;

};



// ─── Compact Header ──────────────────────────────────────────────────

const CompactHeader = ({ title, version, updatedByLabel }) => (

  <View style={hs.wrap}>

    <Svg width={SW} height={152} style={StyleSheet.absoluteFill}>

      <Defs>

        <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">

          <Stop offset={0} stopColor={H.headerDeep} />

          <Stop offset={1} stopColor={H.headerLight} />

        </LinearGradient>

      </Defs>

      <Rect x="0" y="0" width={SW} height={152} fill="url(#headerGrad)" />

    </Svg>

    <HeaderPattern w={SW} h={152} />



    <View style={hs.row}>

      <View style={hs.titleContainer}>

        <Text style={hs.title}>{title}</Text>

      </View>

      {!!version && (

        <View style={hs.versionPill}>

          <Text style={hs.versionText}>{version}</Text>

        </View>

      )}

    </View>



    {!!updatedByLabel && (

      <View style={hs.metaRow}>

        <InfoDotIcon color={H.goldLight} />

        <Text style={hs.metaTxt}>{updatedByLabel}</Text>

      </View>

    )}

  </View>

);



// ─── Reusable Time Field (press to open native picker) ──────────────

const TimeField = ({ icon, label, value, onPress, invalid, half, onClear }) => {

  const display = formatDisplayTime(value);

  return (

    <View style={[fs.wrap, half && fs.half]}>

      <View style={fs.labelRow}>

        <Text style={fs.label}>{label}</Text>

        {onClear && value ? (

          <AnimatedPressable onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>

            <Text style={fs.clearText}>Clear</Text>

          </AnimatedPressable>

        ) : null}

      </View>

      <AnimatedPressable

        style={[fs.inputBox, invalid && fs.inputBoxInvalid]}

        onPress={onPress}

        activeOpacity={0.7}

      >

        {icon}

        <Text style={[fs.inputText, !display && fs.placeholderText]} numberOfLines={1}>

          {display || "--:--"}

        </Text>

        <ChevronIcon />

      </AnimatedPressable>

    </View>

  );

};



// ─── Section Card ────────────────────────────────────────────────────

const SectionCard = ({ icon, title, subtitle, children }) => (

  <View style={ss.card}>

    <View style={ss.headerRow}>

      <View style={ss.iconChip}>{icon}</View>

      <View style={{ flex: 1 }}>

        <Text style={ss.title}>{title}</Text>

        {!!subtitle && <Text style={ss.subtitle}>{subtitle}</Text>}

      </View>

    </View>

    <View style={ss.grid}>{children}</View>

  </View>

);



// ─── Main Component ──────────────────────────────────────────────────

export default function PrayerManagementScreen() {

  const { t } = useTranslation();



  const emptyForm = {

    imsak: "", sunrise: "", dhuha: "",

    fajr_adhan: "", dhuhr_adhan: "", asr_adhan: "", maghrib_adhan: "", isha_adhan: "",

    fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "", jummah: "", jummah_iqamah: "",

    ishraq: "", taraweeh: "", sunset: "",

    notes: "",

  };



  const [form, setForm] = useState(emptyForm);

  const [invalidKeys, setInvalidKeys] = useState({});

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [version, setVersion] = useState(null);

  const [updatedBy, setUpdatedBy] = useState(null);

  const [updatedAt, setUpdatedAt] = useState(null);



  // ── Picker state ──

  const [pickerField, setPickerField] = useState(null); // { key, label } | null

  const [pickerValue, setPickerValue] = useState(new Date());



  const fadeAnim = useRef(new Animated.Value(0)).current;



  const clearInvalid = (key) =>

    setInvalidKeys((prev) => (prev[key] ? { ...prev, [key]: false } : prev));



  const openPicker = (key, label) => {

    setPickerValue(timeStringToDate(form[key]));

    setPickerField({ key, label });

  };



  const closePicker = () => setPickerField(null);



  const applyPickedTime = (key, date) => {

    setForm((prev) => ({ ...prev, [key]: dateToTimeString(date) }));

    clearInvalid(key);

  };



  const confirmPickedTime = (date) => {

    if (pickerField) applyPickedTime(pickerField.key, date);

    closePicker();

  };



  const fetchPrayer = useCallback(async () => {

    try {

      setLoading(true);

      const res = await apiAxios({ method: "get", url: "/prayer/" });

      const d = res.data;

      setForm({

        imsak: d.early?.imsak || "",

        sunrise: d.early?.sunrise || "",

        dhuha: d.early?.dhuha || "",



        fajr_adhan: d.adhan?.fajr || "",

        dhuhr_adhan: d.adhan?.dhuhr || "",

        asr_adhan: d.adhan?.asr || "",

        maghrib_adhan: d.adhan?.maghrib || "",

        isha_adhan: d.adhan?.isha || "",



        fajr: d.prayer?.fajr || "",

        dhuhr: d.prayer?.dhuhr || "",

        asr: d.prayer?.asr || "",

        maghrib: d.prayer?.maghrib || "",

        isha: d.prayer?.isha || "",

        jummah: d.prayer?.jummah || "",

        jummah_iqamah: d.prayer?.jummah_iqamah || "",



        ishraq: d.special?.ishraq || "",

        taraweeh: d.special?.taraweeh || "",

        sunset: d.special?.sunset || "",



        notes: d.notes || "",

      });

      setVersion(d.version || null);

      setUpdatedBy(d.updated_by || null);

      setUpdatedAt(d.updated_at || null);

    } catch (err) {

      logger.log("PRAYER FETCH ERROR:", err?.response?.data || err.message);

      Alert.alert(t("prayerManagement.errorTitle"), t("prayerManagement.loadError"));

    } finally {

      setLoading(false);

      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();

    }

  }, [t]);



  useEffect(() => { fetchPrayer(); }, [fetchPrayer]);



  const REQUIRED_KEYS = [

    "imsak", "sunrise", "dhuha",

    "fajr_adhan", "dhuhr_adhan", "asr_adhan", "maghrib_adhan", "isha_adhan",

    "fajr", "dhuhr", "asr", "maghrib", "isha", "jummah", "jummah_iqamah",

  ];

  const OPTIONAL_TIME_KEYS = ["ishraq", "taraweeh", "sunset"];



  const validateForm = () => {

    const nextInvalid = {};

    let firstInvalidLabel = null;



    REQUIRED_KEYS.forEach((key) => {

      const val = (form[key] || "").trim();

      if (!TIME_RE.test(val)) {

        nextInvalid[key] = true;

        if (!firstInvalidLabel) firstInvalidLabel = t(`prayerManagement.fields.${key}`);

      }

    });



    OPTIONAL_TIME_KEYS.forEach((key) => {

      const val = (form[key] || "").trim();

      if (val && !TIME_RE.test(val)) {

        nextInvalid[key] = true;

        if (!firstInvalidLabel) firstInvalidLabel = t(`prayerManagement.fields.${key}`);

      }

    });



    setInvalidKeys(nextInvalid);

    return { valid: Object.keys(nextInvalid).length === 0, firstInvalidLabel };

  };



  const submitPrayer = async () => {

    const { valid, firstInvalidLabel } = validateForm();

    if (!valid) {

      return Alert.alert(

        t("prayerManagement.invalidTimeTitle"),

        t("prayerManagement.invalidTimeMsg", { field: firstInvalidLabel })

      );

    }



    try {

      setSaving(true);

      const payload = {

        imsak: form.imsak.trim(),

        sunrise: form.sunrise.trim(),

        dhuha: form.dhuha.trim(),



        fajr_adhan: form.fajr_adhan.trim(),

        dhuhr_adhan: form.dhuhr_adhan.trim(),

        asr_adhan: form.asr_adhan.trim(),

        maghrib_adhan: form.maghrib_adhan.trim(),

        isha_adhan: form.isha_adhan.trim(),



        fajr: form.fajr.trim(),

        dhuhr: form.dhuhr.trim(),

        asr: form.asr.trim(),

        maghrib: form.maghrib.trim(),

        isha: form.isha.trim(),

        jummah: form.jummah.trim(),

        jummah_iqamah: form.jummah_iqamah.trim(),



        ishraq: form.ishraq.trim() || null,

        taraweeh: form.taraweeh.trim() || null,

        sunset: form.sunset.trim() || null,



        notes: form.notes.trim() || null,

      };



      const res = await authApiAxios({ method: "put", url: "/prayer/", data: payload });

      const d = res.data?.data;

      if (d) {

        setVersion(d.version || null);

        setUpdatedBy(d.updated_by || null);

        setUpdatedAt(d.updated_at || null);

      }



      Alert.alert(t("prayerManagement.successTitle"), t("prayerManagement.successMsg"));

    } catch (err) {

      logger.log("PRAYER UPDATE ERROR:", err?.response?.data || err.message);

      Alert.alert(

        t("prayerManagement.errorTitle"),

        err?.response?.data?.detail || t("prayerManagement.errorMsg")

      );

    } finally {

      setSaving(false);

    }

  };



  const updatedByLabel =

    updatedBy && updatedAt

      ? t("prayerManagement.lastUpdated", {

          name: updatedBy,

          date: new Date(updatedAt).toLocaleString(),

        })

      : null;



  if (loading) {

    return (

      <View style={styles.root}>


        <CompactHeader title={t("prayerManagement.title")} version={null} updatedByLabel={null} />

        <View style={styles.loadingWrap}>

          <ActivityIndicator color={H.headerLight} size="large" />

          <Text style={styles.loadingText}>{t("prayerManagement.loading")}</Text>

        </View>

      </View>

    );

  }



  return (

    <View style={styles.root}>




      <CompactHeader

        title={t("prayerManagement.title")}

        version={version ? t("prayerManagement.versionLabel", { version }) : null}

        updatedByLabel={updatedByLabel}

      />



      <KeyboardAvoidingView

        style={{ flex: 1 }}

        behavior={IOS ? "padding" : undefined}

        keyboardVerticalOffset={IOS ? 90 : 0}

      >

        <Animated.ScrollView

          style={[styles.scroll, { opacity: fadeAnim }]}

          contentContainerStyle={styles.scrollContent}

          showsVerticalScrollIndicator={false}

        >

          <SectionCard

            icon={<SunIcon />}

            title={t("prayerManagement.earlySection")}

            subtitle={t("prayerManagement.earlySectionSub")}

          >

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.imsak")} value={form.imsak} onPress={() => openPicker("imsak", t("prayerManagement.fields.imsak"))} invalid={invalidKeys.imsak} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.sunrise")} value={form.sunrise} onPress={() => openPicker("sunrise", t("prayerManagement.fields.sunrise"))} invalid={invalidKeys.sunrise} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.dhuha")} value={form.dhuha} onPress={() => openPicker("dhuha", t("prayerManagement.fields.dhuha"))} invalid={invalidKeys.dhuha} />

          </SectionCard>



          <SectionCard

            icon={<MoonIcon />}

            title={t("prayerManagement.adhanSection")}

            subtitle={t("prayerManagement.adhanSectionSub")}

          >

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.fajr")} value={form.fajr_adhan} onPress={() => openPicker("fajr_adhan", t("prayerManagement.fields.fajr"))} invalid={invalidKeys.fajr_adhan} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.dhuhr")} value={form.dhuhr_adhan} onPress={() => openPicker("dhuhr_adhan", t("prayerManagement.fields.dhuhr"))} invalid={invalidKeys.dhuhr_adhan} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.asr")} value={form.asr_adhan} onPress={() => openPicker("asr_adhan", t("prayerManagement.fields.asr"))} invalid={invalidKeys.asr_adhan} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.maghrib")} value={form.maghrib_adhan} onPress={() => openPicker("maghrib_adhan", t("prayerManagement.fields.maghrib"))} invalid={invalidKeys.maghrib_adhan} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.isha")} value={form.isha_adhan} onPress={() => openPicker("isha_adhan", t("prayerManagement.fields.isha"))} invalid={invalidKeys.isha_adhan} />

          </SectionCard>



          <SectionCard

            icon={<ClockIcon />}

            title={t("prayerManagement.prayerSection")}

            subtitle={t("prayerManagement.prayerSectionSub")}

          >

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.fajr")} value={form.fajr} onPress={() => openPicker("fajr", t("prayerManagement.fields.fajr"))} invalid={invalidKeys.fajr} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.dhuhr")} value={form.dhuhr} onPress={() => openPicker("dhuhr", t("prayerManagement.fields.dhuhr"))} invalid={invalidKeys.dhuhr} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.asr")} value={form.asr} onPress={() => openPicker("asr", t("prayerManagement.fields.asr"))} invalid={invalidKeys.asr} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.maghrib")} value={form.maghrib} onPress={() => openPicker("maghrib", t("prayerManagement.fields.maghrib"))} invalid={invalidKeys.maghrib} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.isha")} value={form.isha} onPress={() => openPicker("isha", t("prayerManagement.fields.isha"))} invalid={invalidKeys.isha} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.jummah")} value={form.jummah} onPress={() => openPicker("jummah", t("prayerManagement.fields.jummah"))} invalid={invalidKeys.jummah} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.jummahIqamah")} value={form.jummah_iqamah} onPress={() => openPicker("jummah_iqamah", t("prayerManagement.fields.jummahIqamah"))} invalid={invalidKeys.jummah_iqamah} />

          </SectionCard>



          <SectionCard

            icon={<StarIcon />}

            title={t("prayerManagement.specialSection")}

            subtitle={t("prayerManagement.specialSectionSub")}

          >

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.ishraq")} value={form.ishraq} onPress={() => openPicker("ishraq", t("prayerManagement.fields.ishraq"))} invalid={invalidKeys.ishraq} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.taraweeh")} value={form.taraweeh} onPress={() => openPicker("taraweeh", t("prayerManagement.fields.taraweeh"))} onClear={() => setForm((f) => ({ ...f, taraweeh: "" }))} invalid={invalidKeys.taraweeh} />

            <TimeField icon={<ClockIcon />} half label={t("prayerManagement.fields.sunset")} value={form.sunset} onPress={() => openPicker("sunset", t("prayerManagement.fields.sunset"))} invalid={invalidKeys.sunset} />

          </SectionCard>



          <View style={ss.card}>

            <View style={ss.headerRow}>

              <View style={ss.iconChip}><NoteIcon /></View>

              <View style={{ flex: 1 }}>

                <Text style={ss.title}>{t("prayerManagement.notesSection")}</Text>

                <Text style={ss.subtitle}>{t("prayerManagement.notesSectionSub")}</Text>

              </View>

            </View>

            <TextInput

              value={form.notes}

              onChangeText={(text) => setForm((prev) => ({ ...prev, notes: text }))}

              placeholder={t("prayerManagement.notesPlaceholder")}

              placeholderTextColor={H.textMuted}

              multiline

              textAlignVertical="top"

              style={styles.notesInput}

            />

          </View>



          <AnimatedPressable

            style={[styles.submit, saving && styles.submitDisabled]}

            onPress={submitPrayer}

            disabled={saving}

            activeOpacity={0.85}

          >

            {saving ? (

              <ActivityIndicator color={H.white} />

            ) : (

              <>

                <SaveIcon />

                <Text style={styles.submitText}>{t("prayerManagement.save")}</Text>

              </>

            )}

          </AnimatedPressable>



          <View style={{ height: 40 }} />

        </Animated.ScrollView>

      </KeyboardAvoidingView>



      <TimePickerModal

        visible={!!pickerField}

        value={pickerValue}

        label={pickerField?.label}

        onConfirm={confirmPickedTime}

        onCancel={closePicker}

        cancelLabel={t("prayerManagement.pickerCancel")}

        doneLabel={t("prayerManagement.pickerDone")}

      />

    </View>

  );

}



// ─── Custom JS-only time picker (no native module dependency) ──────────

function TimePickerModal({ visible, value, label, onConfirm, onCancel, cancelLabel, doneLabel }) {

  const [hour, setHour] = useState("12");

  const [minute, setMinute] = useState("00");

  const [period, setPeriod] = useState("AM");



  useEffect(() => {

    if (!visible) return;

    const h24 = value.getHours();

    const period = h24 >= 12 ? "PM" : "AM";

    let h12 = h24 % 12;

    if (h12 === 0) h12 = 12;

    setHour(String(h12));

    setMinute(String(value.getMinutes()).padStart(2, "0"));

    setPeriod(period);

  }, [visible, value]);



  const confirm = () => {

    const h = parseInt(hour, 10);

    const m = parseInt(minute, 10);

    if (!h || h < 1 || h > 12 || isNaN(m) || m < 0 || m > 59) {

      Alert.alert("Invalid time", "Please enter a valid hour (1-12) and minute (0-59).");

      return;

    }

    let h24 = h % 12;

    if (period === "PM") h24 += 12;

    const d = new Date(value);

    d.setHours(h24, m, 0, 0);

    onConfirm(d);

  };



  return (

    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>

      <AnimatedPressable style={ps.backdrop} activeOpacity={1} onPress={onCancel}>

        <AnimatedPressable activeOpacity={1} style={ps.sheet} onPress={() => {}}>

          <View style={ps.sheetHeader}>

            <AnimatedPressable onPress={onCancel}>

              <Text style={ps.cancelText}>{cancelLabel}</Text>

            </AnimatedPressable>

            <Text style={ps.sheetTitle}>{label}</Text>

            <AnimatedPressable onPress={confirm}>

              <Text style={ps.doneText}>{doneLabel}</Text>

            </AnimatedPressable>

          </View>

          <View style={ps.pickerRow}>

            <View style={ps.pickerField}>

              <Text style={ps.pickerFieldLabel}>HH</Text>

              <TextInput style={ps.pickerInput} value={hour} onChangeText={setHour}

                keyboardType="numeric" maxLength={2} selectTextOnFocus />

            </View>

            <Text style={ps.pickerSep}>:</Text>

            <View style={ps.pickerField}>

              <Text style={ps.pickerFieldLabel}>MM</Text>

              <TextInput style={ps.pickerInput} value={minute} onChangeText={setMinute}

                keyboardType="numeric" maxLength={2} selectTextOnFocus />

            </View>

            <View style={ps.ampmCol}>

              <AnimatedPressable

                style={[ps.ampmBtn, period === "AM" && ps.ampmBtnActive]}

                onPress={() => setPeriod("AM")}

              >

                <Text style={[ps.ampmTxt, period === "AM" && ps.ampmTxtActive]}>AM</Text>

              </AnimatedPressable>

              <AnimatedPressable

                style={[ps.ampmBtn, period === "PM" && ps.ampmBtnActive]}

                onPress={() => setPeriod("PM")}

              >

                <Text style={[ps.ampmTxt, period === "PM" && ps.ampmTxtActive]}>PM</Text>

              </AnimatedPressable>

            </View>

          </View>

        </AnimatedPressable>

      </AnimatedPressable>

    </Modal>

  );

}



// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  root: { flex: 1, backgroundColor: H.bg },

  scroll: { flex: 1 },

  scrollContent: { padding: 16, paddingBottom: 24 },



  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },

  loadingText: { marginTop: 12, fontSize: 14, color: H.textMuted, fontWeight: "600" },



  notesInput: {

    marginTop: 4,

    backgroundColor: H.bg,

    padding: 14,

    borderRadius: RADII.md,

    borderWidth: 1,

    borderColor: H.cardBorder,

    fontSize: 14,

    color: H.textDark,

    minHeight: 90,

  },



  submit: {

    backgroundColor: H.headerDeep,

    padding: 18,

    marginTop: 8,

    borderRadius: RADII.md,

    alignItems: "center",

    justifyContent: "center",

    flexDirection: "row",

    gap: 10,

    ...shadow(6, 0.14),

  },

  submitDisabled: { opacity: 0.55 },

  submitText: { color: H.white, fontWeight: "700", fontSize: 16 },

});



// ─── Section Card Styles ───────────────────────────────────────────────

const ss = StyleSheet.create({

  card: {

    backgroundColor: H.card,

    padding: 18,

    borderRadius: RADII.xl,

    borderWidth: 1,

    borderColor: H.cardBorder,

    marginBottom: 14,

    ...shadow(4, 0.06),

  },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 12 },

  iconChip: {

    width: 34, height: 34, borderRadius: 12,

    backgroundColor: H.goldLight + "22",

    borderWidth: 1, borderColor: H.goldLight + "45",

    justifyContent: "center", alignItems: "center",

  },

  title: { fontSize: 15.5, fontWeight: "700", color: H.textDark, fontFamily: FONTS.display },

  subtitle: { fontSize: 12, color: H.textMuted, marginTop: 2 },

  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },

});



// ─── Time Field Styles ─────────────────────────────────────────────────

const fs = StyleSheet.create({

  wrap: { width: "100%", paddingHorizontal: 6, marginBottom: 14 },

  half: { width: "50%" },

  label: { fontSize: 11.5, fontWeight: "700", color: H.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },

  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  clearText: { fontSize: 11, fontWeight: "700", color: H.gold, textDecorationLine: "underline", marginBottom: 6 },

  inputBox: {

    flexDirection: "row", alignItems: "center", gap: 8,

    backgroundColor: H.bg,

    paddingHorizontal: 14, paddingVertical: 12,

    borderRadius: RADII.sm,

    borderWidth: 1, borderColor: H.cardBorder,

  },

  inputBoxInvalid: { borderColor: H.error, backgroundColor: H.errorBg },

  inputText: { flex: 1, fontSize: 15, color: H.textDark, fontWeight: "600", fontVariant: ["tabular-nums"] },

  placeholderText: { color: H.textMuted, fontWeight: "500" },

});



// ─── iOS Picker Sheet Styles ────────────────────────────────────────────

const ps = StyleSheet.create({

  backdrop: { flex: 1, backgroundColor: "rgba(5,20,14,0.4)", justifyContent: "flex-end" },

  sheet: {

    backgroundColor: H.card,

    borderTopLeftRadius: 22,

    borderTopRightRadius: 22,

    paddingBottom: 24,

    ...shadow(-4, 0.15),

  },

  sheetHeader: {

    flexDirection: "row", justifyContent: "space-between", alignItems: "center",

    paddingHorizontal: 20, paddingVertical: 16,

    borderBottomWidth: 1, borderBottomColor: H.cardBorder,

  },

  sheetTitle: { fontSize: 15, fontWeight: "700", color: H.textDark, fontFamily: FONTS.display },

  cancelText: { fontSize: 15, color: H.textMuted, fontWeight: "600" },

  doneText: { fontSize: 15, color: H.headerLight, fontWeight: "700" },

  pickerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center",

              gap: 8, paddingHorizontal: 20, paddingVertical: 28 },

  pickerField: { alignItems: "center" },

  pickerFieldLabel: { fontSize: 11, color: H.textMuted, fontWeight: "600", marginBottom: 4, letterSpacing: 0.5 },

  pickerInput: { borderWidth: 1.5, borderColor: H.cardBorder, borderRadius: 8, paddingVertical: 10,

                paddingHorizontal: 14, fontSize: 20, fontWeight: "700", color: H.textDark,

                textAlign: "center", minWidth: 56 },

  pickerSep: { fontSize: 24, color: H.textMuted, fontWeight: "700", paddingBottom: 8 },

  ampmCol: { marginLeft: 12, gap: 6 },

  ampmBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,

            borderWidth: 1.5, borderColor: H.cardBorder },

  ampmBtnActive: { backgroundColor: H.headerLight, borderColor: H.headerLight },

  ampmTxt: { fontSize: 13, fontWeight: "700", color: H.textMuted },

  ampmTxtActive: { color: "#fff" },

});



// ─── Header Styles ────────────────────────────────────────────────────

const hs = StyleSheet.create({

  wrap: {

    height: 152,

    paddingHorizontal: 20,

    overflow: "hidden",

    borderBottomLeftRadius: 24,

    borderBottomRightRadius: 24,

  },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },

  titleContainer: { flex: 1, marginRight: 12 },

  title: { color: H.white, fontSize: 18, fontWeight: "700", fontFamily: FONTS.display },

  versionPill: {

    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,

    backgroundColor: "rgba(255,255,255,0.12)",

    borderWidth: 1, borderColor: "rgba(212,175,55,0.5)",

  },

  versionText: { color: H.goldLight, fontSize: 11, fontWeight: "700" },

  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 8 },

  metaTxt: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "600" },

  timeInputContainer: {

    paddingVertical: 32,

    paddingHorizontal: 24,

    alignItems: "center",

  },

  timeInput: {

    width: "100%",

    height: 56,

    fontSize: 24,

    color: H.textDark,

    fontWeight: "600",

    textAlign: "center",

    backgroundColor: H.bg,

    borderRadius: RADII.md,

    borderWidth: 1,

    borderColor: H.cardBorder,

    marginBottom: 12,

  },

  timeHint: {

    fontSize: 13,

    color: H.textMuted,

    textAlign: "center",

    fontWeight: "500",

  },

});