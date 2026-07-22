package com.mohideen

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService

/**
 * Both PrayerSyncWorker and BootReceiver launch their headless task services via
 * startForegroundService(), which requires the service to call startForeground()
 * within ~5s or the OS kills the app with ForegroundServiceDidNotStartInTimeException.
 * HeadlessJsTaskService never does this on its own, so subclasses do it here.
 */
abstract class ForegroundHeadlessJsTaskService : HeadlessJsTaskService() {

    override fun onCreate() {
        super.onCreate()
        val channelId = "background_sync_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(channelId) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(channelId, "Background Sync", NotificationManager.IMPORTANCE_MIN)
                )
            }
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Mohideen Masjid")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    companion object {
        private const val NOTIF_ID = 9910
    }
}
