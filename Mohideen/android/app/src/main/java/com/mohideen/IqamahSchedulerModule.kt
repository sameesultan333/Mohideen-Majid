package com.mohideen

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.TimeUnit

/**
 * Native module exposed to JS as NativeModules.IqamahScheduler.
 * Handles both adhan (immediate) and iqamah (delayed WorkManager) notifications
 * so sounds play reliably on Samsung devices regardless of app state.
 */
class IqamahSchedulerModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "IqamahScheduler"

    /**
     * Show an adhan notification immediately with explicit sound on the prayer_adhan channel.
     * Use this for foreground FCM handling (React Native Firebase suppresses notification
     * messages when the app is open) and as a reliable fallback for background.
     */
    @ReactMethod
    fun showAdhanNow(prayerName: String) {
        val ctx = reactApplicationContext
        val soundUri = android.net.Uri.parse("android.resource://${ctx.packageName}/raw/adhan")
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = PendingIntent.getActivity(ctx, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE)
        // CATEGORY_ALARM so the adhan can sound through Do Not Disturb — for a
        // call to prayer that's the intended behavior. The volume stream is
        // governed by the channel's own AudioAttributes (USAGE_NOTIFICATION in
        // MainApplication.kt), not by this category, so it plays through the
        // normal notification volume.
        val notification = NotificationCompat.Builder(ctx, "prayer_adhan")
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ctx.getColor(R.color.notification_color))
            .setContentTitle("🕌 $prayerName Adhan")
            .setContentText("The Adhan for $prayerName has begun.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setSound(soundUri)
            .build()
        nm.notify(ADHAN_NOTIF_ID, notification)
    }

    /**
     * Schedule iqamah notification at a specific epoch millisecond time.
     * Call this from the adhan FCM background handler with the iqamah epoch ms.
     */
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

    /** Cancel any pending iqamah WorkManager task (e.g. if times change). */
    @ReactMethod
    fun cancelIqamah(prayerName: String) {
        WorkManager.getInstance(reactApplicationContext)
            .cancelUniqueWork("iqamah_${prayerName.lowercase()}")
    }

    companion object {
        const val ADHAN_NOTIF_ID = 9901
    }
}
