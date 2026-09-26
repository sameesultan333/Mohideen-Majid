package com.mohideen

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
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
    fun showAdhanNow(prayerName: String) {
        postPrayerNotification(
            ADHAN_CHANNEL_ID,
            ADHAN_NOTIF_ID,
            "🕌 $prayerName Adhan",
            "The Adhan for $prayerName has begun.",
        )
    }

    @ReactMethod
    fun showIqamahNow(prayerName: String) {
        postPrayerNotification(
            IQAMAH_CHANNEL_ID,
            IQAMAH_NOTIF_ID,
            "🕌 $prayerName Iqamah",
            "Iqamah is starting — join the congregation.",
        )
    }

    /** Fire test Adhan notification immediately (channel sound). */
    @ReactMethod
    fun showTestAdhan() {
        postPrayerNotification(
            ADHAN_CHANNEL_ID,
            TEST_ADHAN_NOTIF_ID,
            "Test Adhan",
            "If you hear the adhan, notification sound is working.",
        )
    }

    /** Fire test Iqamah notification immediately (channel sound). */
    @ReactMethod
    fun showTestIqamah() {
        postPrayerNotification(
            IQAMAH_CHANNEL_ID,
            TEST_IQAMAH_NOTIF_ID,
            "Test Iqamah",
            "If you hear the iqamah chime, notification sound is working.",
        )
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
    }
}
