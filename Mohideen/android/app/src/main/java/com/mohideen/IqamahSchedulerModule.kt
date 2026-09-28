package com.mohideen

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.TimeUnit

/**
 * Native module exposed to JS as NativeModules.IqamahScheduler.
 * Handles both adhan (immediate) and iqamah (delayed WorkManager) notifications
 * so sounds play reliably on Samsung devices regardless of app state.
 *
 * On Android 8+, notification sound comes from the channel (MainApplication.kt),
 * not per-notification setSound().
 */
class IqamahSchedulerModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "IqamahScheduler"

    private fun contentPendingIntent(ctx: Context, requestCode: Int): PendingIntent? {
        val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
            ?: return null
        return PendingIntent.getActivity(
            ctx,
            requestCode,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun postPrayerNotification(
        channelId: String,
        notifId: Int,
        title: String,
        body: String,
    ) {
        val ctx = reactApplicationContext
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = contentPendingIntent(ctx, notifId)

        val notification = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ctx.getColor(R.color.notification_color))
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .apply { if (pi != null) setContentIntent(pi) }
            .build()

        nm.notify(notifId, notification)
        Log.i(TAG, "Posted notification id=$notifId channel=$channelId title=$title")
    }

    @ReactMethod
    fun showAdhanNow(prayerName: String, eventId: String?) {
        if (!startPrayerAudio(PrayerAudioService.TYPE_ADHAN, eventId ?: eventIdFor("now", prayerName, PrayerAudioService.TYPE_ADHAN), prayerName)) return
        postPrayerNotification(
            ADHAN_CHANNEL_ID,
            ADHAN_NOTIF_ID,
            "🕌 $prayerName Adhan",
            "The Adhan for $prayerName has begun.",
        )
    }

    @ReactMethod
    fun showIqamahNow(prayerName: String, eventId: String?) {
        if (!startPrayerAudio(PrayerAudioService.TYPE_IQAMAH, eventId ?: eventIdFor("now", prayerName, PrayerAudioService.TYPE_IQAMAH), prayerName)) return
        postPrayerNotification(
            IQAMAH_CHANNEL_ID,
            IQAMAH_NOTIF_ID,
            "🕌 $prayerName Iqamah",
            "Iqamah is starting - join the congregation.",
        )
    }

    /** Fire test Adhan notification immediately (channel sound). */
    @ReactMethod
    fun showTestAdhan() {
        startPrayerAudio(PrayerAudioService.TYPE_ADHAN, eventIdFor("test_${System.currentTimeMillis()}", "adhan", PrayerAudioService.TYPE_ADHAN), "Test")
    }

    /** Fire test Iqamah notification immediately (channel sound). */
    @ReactMethod
    fun showTestIqamah() {
        startPrayerAudio(PrayerAudioService.TYPE_IQAMAH, eventIdFor("test_${System.currentTimeMillis()}", "iqamah", PrayerAudioService.TYPE_IQAMAH), "Test")
    }

    @ReactMethod
    fun scheduleIqamah(prayerName: String, epochMs: Double) {
        val delayMs = epochMs.toLong() - System.currentTimeMillis()
        if (delayMs <= 0) return

        val data = Data.Builder()
            .putString("prayer_name", prayerName)
            .build()

        val request = OneTimeWorkRequestBuilder<IqamahWorker>()
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .setInputData(data)
            .build()

        WorkManager.getInstance(reactApplicationContext)
            .enqueueUniqueWork(
                "iqamah_${prayerName.lowercase()}",
                ExistingWorkPolicy.REPLACE,
                request
            )
    }

    @ReactMethod
    fun schedulePrayerEvent(prayerName: String, type: String, epochMs: Double, eventId: String) {
        val triggerAt = epochMs.toLong()
        if (triggerAt <= System.currentTimeMillis()) return
        val ctx = reactApplicationContext
        val intent = Intent(ctx, PrayerAlarmReceiver::class.java).apply {
            putExtra(EXTRA_EVENT_ID, eventId)
            putExtra(EXTRA_TYPE, type)
            putExtra("prayer_name", prayerName)
        }
        val requestCode = eventId.hashCode() and 0x7fffffff
        val pendingIntent = PendingIntent.getBroadcast(
            ctx, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarmManager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            }
        } catch (_: SecurityException) {
            // Android 12+ can deny exact alarms. Keep the offline path alive
            // with an idle-allowed inexact alarm rather than crashing scheduling.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            }
        }
        val prefs = ctx.getSharedPreferences(PRAYER_ALARM_PREFS, Context.MODE_PRIVATE)
        prefs.edit().putStringSet(
            SCHEDULED_REQUEST_CODES,
            (prefs.getStringSet(SCHEDULED_REQUEST_CODES, emptySet()) ?: emptySet()) + requestCode.toString(),
        ).apply()
    }

    @ReactMethod
    fun cancelPrayerEvents() {
        val ctx = reactApplicationContext
        val alarmManager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = ctx.getSharedPreferences(PRAYER_ALARM_PREFS, Context.MODE_PRIVATE)
        val codes = prefs.getStringSet(SCHEDULED_REQUEST_CODES, emptySet()) ?: emptySet()
        codes.forEach { code ->
            val intent = Intent(ctx, PrayerAlarmReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                ctx, code.toInt(), intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )
            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent)
                pendingIntent.cancel()
            }
        }
        prefs.edit().remove(SCHEDULED_REQUEST_CODES).apply()
    }

    @ReactMethod
    fun cancelIqamah(prayerName: String) {
        WorkManager.getInstance(reactApplicationContext)
            .cancelUniqueWork("iqamah_${prayerName.lowercase()}")
    }

    @ReactMethod
    fun canScheduleExactAlarms(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            promise.resolve(true)
            return
        }
        val am = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        promise.resolve(am.canScheduleExactAlarms())
    }

    @ReactMethod
    fun requestExactAlarmPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val ctx = reactApplicationContext
        val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
            data = Uri.parse("package:${ctx.packageName}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        ctx.startActivity(intent)
    }

    companion object {
        private const val TAG = "MohideenNotify"
        const val ADHAN_CHANNEL_ID = "prayer_adhan"
        const val IQAMAH_CHANNEL_ID = "prayer_iqamah"
        const val ADHAN_NOTIF_ID = 9901
        const val IQAMAH_NOTIF_ID = 9900
        const val TEST_ADHAN_NOTIF_ID = 9902
        const val TEST_IQAMAH_NOTIF_ID = 9903
        const val PRAYER_AUDIO_CHANNEL_ID = "prayer_audio_playback"
        const val EXTRA_EVENT_ID = "event_id"
        const val EXTRA_TYPE = "audio_type"
        private const val PRAYER_ALARM_PREFS = "prayer_alarm_prefs"
        private const val SCHEDULED_REQUEST_CODES = "scheduled_request_codes"

        fun claimEvent(context: Context, eventId: String): Boolean {
            val prefs = context.getSharedPreferences("prayer_event_dedup", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val stored = prefs.getStringSet("claimed", emptySet()) ?: emptySet()
            val fresh = stored.filter { it.substringAfterLast('|').toLongOrNull()?.let { ts -> now - ts < 172800000L } == true }.toMutableSet()
            if (fresh.any { it.startsWith("$eventId|") }) return false
            fresh.add("$eventId|$now")
            prefs.edit().putStringSet("claimed", fresh).apply()
            return true
        }
    }

    private fun eventIdFor(prefix: String, prayerName: String, type: String) = "$prefix:${prayerName.lowercase()}:$type"

    private fun startPrayerAudio(type: String, eventId: String, prayerName: String): Boolean {
        if (!claimEvent(reactApplicationContext, eventId)) return false
        val intent = Intent(reactApplicationContext, PrayerAudioService::class.java).apply {
            putExtra(PrayerAudioService.EXTRA_TYPE, type)
            putExtra(EXTRA_EVENT_ID, eventId)
            putExtra(PrayerAudioService.EXTRA_PRAYER_NAME, prayerName)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }
        return true
    }
}
