package com.mohideen

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Constraints
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.soloader.SoLoader
import java.util.Calendar
import java.util.concurrent.TimeUnit

class MainApplication : Application(), ReactApplication {

  companion object {
    private const val DEFAULT_CHANNEL_ID = "default_channel_id"
    private const val ADHAN_CHANNEL_ID   = "prayer_adhan"
    private const val IQAMAH_CHANNEL_ID  = "prayer_iqamah"
    private const val PRAYER_AUDIO_CHANNEL_ID = "prayer_audio_playback"

    // Prayer sync moved from hourly to once-daily (battery + Samsung Device
    // Care crash report — see PrayerSyncWorker/PrayerSyncService comments).
    // Anchored to an early-morning window when the phone is asleep and
    // unlikely to be in active use.
    private const val PRAYER_SYNC_PREFS         = "prayer_sync_prefs"
    private const val PRAYER_SYNC_MIGRATED_KEY  = "migrated_to_daily_v1"
    private const val PRAYER_SYNC_WINDOW_HOUR   = 3 // 3 AM device-local time
  }

  private val mReactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {

      override fun getUseDeveloperSupport(): Boolean {
        return BuildConfig.DEBUG
      }

      override fun getPackages(): List<ReactPackage> {
        return PackageList(this@MainApplication).packages + listOf(IqamahSchedulerPackage())
      }

      override fun getJSMainModuleName(): String {
        return "index"
      }
    }

  override fun getReactNativeHost(): ReactNativeHost {
    return mReactNativeHost
  }

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, false)
    createNotificationChannel()
    schedulePrayerSyncWorker()
  }

  /**
   * Was hourly — a Samsung Device Care crash report plus the desire to cut
   * background battery use moved this to once daily, anchored to ~3 AM
   * local time. The worker still does a cheap `/prayer/version` check first
   * and only downloads the full schedule when it changed (PrayerSyncTask.js);
   * only the WAKE-UP frequency changed, not that logic.
   *
   * Migration is one-shot (REPLACE once, guarded by a SharedPreferences
   * flag, then KEEP forever after) rather than recomputing+re-enqueuing on
   * every onCreate(): onCreate() runs on EVERY process start, including
   * ones triggered by this very worker, so recomputing "next 3 AM from now"
   * every time and always re-enqueuing would keep sliding the actual sync
   * time later each time the app happens to be opened before it fires.
   * REPLACE-once forces existing installs off the old hourly schedule;
   * KEEP after that leaves the already-anchored time alone.
   */
  private fun schedulePrayerSyncWorker() {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()
    val request = PeriodicWorkRequestBuilder<PrayerSyncWorker>(24, TimeUnit.HOURS)
      .setInitialDelay(millisUntilNextWindow(PRAYER_SYNC_WINDOW_HOUR), TimeUnit.MILLISECONDS)
      .setConstraints(constraints)
      .build()

    val prefs = getSharedPreferences(PRAYER_SYNC_PREFS, Context.MODE_PRIVATE)
    val policy = if (prefs.getBoolean(PRAYER_SYNC_MIGRATED_KEY, false)) {
      ExistingPeriodicWorkPolicy.KEEP
    } else {
      prefs.edit().putBoolean(PRAYER_SYNC_MIGRATED_KEY, true).apply()
      ExistingPeriodicWorkPolicy.REPLACE
    }
    WorkManager.getInstance(this).enqueueUniquePeriodicWork("prayer_sync", policy, request)
  }

  private fun millisUntilNextWindow(hourOfDay: Int): Long {
    val now = Calendar.getInstance()
    val target = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hourOfDay)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      if (before(now)) add(Calendar.DAY_OF_MONTH, 1)
    }
    return target.timeInMillis - now.timeInMillis
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    // Version key — bump CHANNEL_VERSION whenever sound/importance changes.
    // Android permanently caches channel settings; deleting and recreating is the
    // only way to apply new sounds without asking users to reinstall.
    val CHANNEL_VERSION = 9
    val prefs = getSharedPreferences("channel_prefs", Context.MODE_PRIVATE)
    val installedVersion = prefs.getInt("channel_version", 0)

    if (installedVersion < CHANNEL_VERSION) {
      // Delete old channels so they get recreated with correct sounds
      Log.i("MohideenNotify", "Migrating notification channels v$installedVersion -> v$CHANNEL_VERSION")
      nm.deleteNotificationChannel(ADHAN_CHANNEL_ID)
      nm.deleteNotificationChannel(IQAMAH_CHANNEL_ID)
      nm.deleteNotificationChannel(DEFAULT_CHANNEL_ID)
      nm.deleteNotificationChannel(PRAYER_AUDIO_CHANNEL_ID)
      prefs.edit().putInt("channel_version", CHANNEL_VERSION).apply()
    } else if (nm.getNotificationChannel(ADHAN_CHANNEL_ID) != null &&
               nm.getNotificationChannel(IQAMAH_CHANNEL_ID) != null &&
               nm.getNotificationChannel(DEFAULT_CHANNEL_ID) != null) {
      // Every createNotificationChannel() call below is a blocking binder IPC
      // to NotificationManagerService, paid again on every single process
      // start (including ones woken just to run a headless FCM/WorkManager
      // task) even though re-creating an already-identical channel is a
      // documented no-op. Skipping is only safe when BOTH the version check
      // above found nothing to migrate AND all three channels are confirmed
      // to still exist — the explicit null-check matters because a user can
      // delete a channel manually from system notification settings, and if
      // that ever happens this still falls through to recreate it below
      // rather than silently leaving Adhan/Iqamah with no channel to post to.
      Log.d("MohideenNotify", "Notification channels already present (v$CHANNEL_VERSION)")
      return
    }

    val notifColor = getColor(R.color.notification_color)

    nm.createNotificationChannel(NotificationChannel(
      DEFAULT_CHANNEL_ID,
      "General Notifications",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Announcements and updates from Mohideen Masjid"
      enableVibration(true)
      lightColor = notifColor
    })

    // Prayer channels are UI-only. PrayerAudioService owns playback and its
    // USAGE_ALARM audio focus, so notification delivery cannot stop the audio.
    nm.createNotificationChannel(NotificationChannel(
      ADHAN_CHANNEL_ID,
      "Adhan",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Adhan call for each prayer"
      // Playback is owned by PrayerAudioService; this channel is UI only.
      setSound(null, null)
      enableVibration(true)
      lightColor = notifColor
      // Ask to sound through Do Not Disturb. The system honours this only when
      // the user has granted DND policy access, and silently ignores it
      // otherwise — it never throws and never blocks channel creation.
      setBypassDnd(true)
    })

    nm.createNotificationChannel(NotificationChannel(
      IQAMAH_CHANNEL_ID,
      "Iqamah / Prayer Started",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Congregation start reminder"
      // Playback is owned by PrayerAudioService; this channel is UI only.
      setSound(null, null)
      enableVibration(true)
      lightColor = notifColor
      setBypassDnd(true)
    })

    nm.createNotificationChannel(NotificationChannel(
      PRAYER_AUDIO_CHANNEL_ID,
      "Prayer audio playback",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Silent foreground notification for Adhan and Iqamah audio"
      setSound(null, null)
      enableVibration(false)
    })

    Log.i(
      "MohideenNotify",
      "Channels ready: prayer UI channels and native audio playback channel",
    )
  }
}
