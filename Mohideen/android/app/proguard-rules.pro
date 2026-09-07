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
# The blanket `-keep class okhttp3/okio { *; }` was removed: both libraries
# ship their own consumer-rules.pro inside their AARs (R8 applies those
# automatically), and neither is used reflectively anywhere in this app —
# only their own consumer rules are actually load-bearing. The blanket keep
# was purely extra dead weight R8 couldn't shrink. -dontwarn stays: it only
# suppresses build-time warnings about optional classes okhttp references
# that aren't on this app's classpath, it has no effect on shrinking.
-dontwarn okhttp3.**
-dontwarn okio.**

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
