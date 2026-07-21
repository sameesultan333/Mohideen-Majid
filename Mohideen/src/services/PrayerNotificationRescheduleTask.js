/**
 * PrayerNotificationRescheduleTask.js
 * 
 * Headless JS task for rescheduling prayer notifications after device boot.
 * This task is triggered by the Android BootReceiver when the device restarts.
 */

import { AppRegistry, Platform } from 'react-native';
import PrayerNotificationService from './PrayerNotificationService';

const TASK_NAME = 'PrayerNotificationReschedule';

const PrayerNotificationRescheduleTask = async (taskData) => {
  console.log('PrayerNotificationRescheduleTask started:', taskData);
  
  try {
    // Initialize the notification service
    await PrayerNotificationService.initialize();
    
    // Reschedule notifications from local storage
    await PrayerNotificationService.rescheduleOnLaunch();
    
    console.log('PrayerNotificationRescheduleTask completed successfully');
  } catch (error) {
    console.error('PrayerNotificationRescheduleTask failed:', error);
  }
};

// Register the headless task
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(TASK_NAME, () => PrayerNotificationRescheduleTask);
}

export default PrayerNotificationRescheduleTask;
