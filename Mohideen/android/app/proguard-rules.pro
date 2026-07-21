# ── React Native ──────────────────────────────────────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.**

# ── React Native Firebase ─────────────────────────────────────────────────────
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**

# ── Google Play Services ──────────────────────────────────────────────────────
-keep class com.google.android.gms.** { *; }
-keep class com.google.firebase.** { *; }
-dontwarn com.google.**

# ── App native modules ────────────────────────────────────────────────────────
-keep class com.mohideen.** { *; }

# ── OkHttp / Retrofit (used by RN internals) ──────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# ── Annotations ───────────────────────────────────────────────────────────────
-dontwarn javax.annotation.**
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions

# ── WorkManager ───────────────────────────────────────────────────────────────
-keep class androidx.work.** { *; }

# ── Crash safety: keep line numbers in stack traces ───────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
