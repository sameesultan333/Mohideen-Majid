package com.didebansimehonar.adreanfarin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import com.facebook.react.HeadlessJsTaskService;

/**
 * BootReceiver
 * 
 * This receiver handles device boot events to reschedule prayer notifications.
 * When the device restarts, this receiver triggers a headless JS task
 * to restore all scheduled prayer notifications from local storage.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();
        Log.d(TAG, "Boot received: " + action);

        // Handle boot completed events
        if (action.equals(Intent.ACTION_BOOT_COMPLETED) || 
            action.equals("android.intent.action.QUICKBOOT_POWERON")) {
            
            Log.d(TAG, "Starting prayer notification rescheduling service");
            
            // Start the headless JS service to reschedule notifications
            Intent serviceIntent = new Intent(context, PrayerNotificationRescheduleService.class);
            context.startService(serviceIntent);
        }
    }
}
