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
# REVERTED: narrowing this to just -dontwarn (removing the blanket -keep)
# broke minifyReleaseWithR8 on a clean build in this project's actual
# toolchain/dependency graph, despite building fine once in a different
# session. Restored to the original working rule rather than relying on a
# result that didn't reproduce. Not worth the size win if it's this fragile.
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
