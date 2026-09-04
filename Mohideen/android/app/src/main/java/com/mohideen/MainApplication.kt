package com.mohideen

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Application
import android.content.Context
import android.os.Build
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
    val CHANNEL_VERSION = 6
    val prefs = getSharedPreferences("channel_prefs", Context.MODE_PRIVATE)
    val installedVersion = prefs.getInt("channel_version", 0)

    if (installedVersion < CHANNEL_VERSION) {
      // Delete old channels so they get recreated with correct sounds
      nm.deleteNotificationChannel(ADHAN_CHANNEL_ID)
      nm.deleteNotificationChannel(IQAMAH_CHANNEL_ID)
      nm.deleteNotificationChannel(DEFAULT_CHANNEL_ID)
      prefs.edit().putInt("channel_version", CHANNEL_VERSION).apply()
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

    // USAGE_ALARM, not USAGE_NOTIFICATION. The adhan is ~2-3 minutes long, and on
    // the notification stream any WhatsApp/SMS arriving mid-adhan plays over it
    // and Android ducks or cuts the adhan short. The alarm stream is not ducked
    // by ordinary notification sounds, so the call to prayer plays through — the
    // same treatment a clock alarm gets. It also follows the user's alarm volume
    // rather than notification volume, which is what people expect for adhan.
    val alarmAudioAttrs = android.media.AudioAttributes.Builder()
      .setUsage(android.media.AudioAttributes.USAGE_ALARM)
      .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    // Ordinary notification sound behaviour for everything that is not adhan.
    val notifAudioAttrs = android.media.AudioAttributes.Builder()
      .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
      .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    // Adhan channel — custom sound: res/raw/adhan.mp3
    val adhanSound = android.net.Uri.parse("android.resource://${packageName}/raw/adhan")
    nm.createNotificationChannel(NotificationChannel(
      ADHAN_CHANNEL_ID,
      "Adhan",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Adhan call for each prayer"
      setSound(adhanSound, alarmAudioAttrs)
      enableVibration(true)
      lightColor = notifColor
      // Ask to sound through Do Not Disturb. The system honours this only when
      // the user has granted DND policy access, and silently ignores it
      // otherwise — it never throws and never blocks channel creation.
      setBypassDnd(true)
    })

    // Iqamah channel — custom sound: res/raw/start_prayer.mp3
    val iqamahSound = android.net.Uri.parse("android.resource://${packageName}/raw/start_prayer")
    nm.createNotificationChannel(NotificationChannel(
      IQAMAH_CHANNEL_ID,
      "Iqamah / Prayer Started",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Congregation start reminder"
      setSound(iqamahSound, alarmAudioAttrs)
      enableVibration(true)
      lightColor = notifColor
    })
  }
}
