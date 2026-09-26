package com.mohideen

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * WorkManager worker that fires the iqamah notification.
 * WorkManager tasks survive Samsung force-stop — unlike AlarmManager alarms,
 * they are managed by the Android system and cannot be wiped by Samsung's
 * recents-swipe FORCE_STOP. This makes it the reliable fallback for iqamah
 * when the server is down after adhan FCM was delivered.
 */
class IqamahWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val prayerName = inputData.getString("prayer_name") ?: "Prayer"
        val title = "🕌 $prayerName Iqamah"
        val body = "Iqamah for $prayerName is starting now."

        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
            as NotificationManager

        val launchIntent = applicationContext.packageManager
            .getLaunchIntentForPackage(applicationContext.packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }

        val pi = launchIntent?.let {
            PendingIntent.getActivity(
                applicationContext, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val notification = NotificationCompat.Builder(
            applicationContext,
            IqamahSchedulerModule.IQAMAH_CHANNEL_ID,
        )
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(applicationContext.getColor(R.color.notification_color))
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .apply { if (pi != null) setContentIntent(pi) }
            .build()

        nm.notify(IqamahSchedulerModule.IQAMAH_NOTIF_ID, notification)
        Log.i("MohideenNotify", "IqamahWorker posted for $prayerName")
        return Result.success()
    }
}
