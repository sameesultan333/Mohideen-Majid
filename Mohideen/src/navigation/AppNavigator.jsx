import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PendingApprovalScreen from "../screens/PendingApprovalScreen";
import CashSubmissionScreen from "../screens/CashSubmissionScreen";

import LogoScreen from "../screens/LogoScreen";

import LoginScreen from "../screens/LoginScreen";

import RegisterScreen from "../screens/RegisterScreen";

import HomeScreen from "../screens/HomeScreen";

import AnnouncementScreen from "../screens/AnnouncementScreen";

import DonationScreen     from "../screens/DonationScreen";

import ProfileScreen     from "../screens/ProfileScreen";

import EditableOptionsScreen from "../screens/EditableOptionsScreen"

import QiblaScreen from "../screens/QiblaScreen"

import DeenScreen from "../screens/DeenScreen"

import ImamQAScreen from "../screens/ImamQAScreen"

import QAViewerScreen from "../screens/QAViewerScreen"

import AskQuestionScreen from "../screens/AskQuestionScreen"

import ImamHadithScreen from "../screens/ImamHadithScreen"

import HadithFeedScreen from "../screens/HadithFeedScreen"

import CollectorScreen from "../screens/CollectorScreen"

import ChandaHistoryScreen from "../screens/ChandaHistoryScreen"

import CollectorHistoryScreen from "../screens/CollectorHistoryScreen"

import ReceiptScreen from "../screens/ReceiptScreen"

import PrayerScreen from "../screens/PrayerScreen"

import FamilyHistoryScreen from "../screens/Familyhistoryscreen"

import HadithDetailScreen from "../screens/HadithDetailScreen"

import NotificationSettingsScreen from "../screens/NotificationSettingsScreen"
import ChangePasswordScreen from "../screens/ChangePasswordScreen"
import ForceChangePasswordScreen from "../screens/ForceChangePasswordScreen"
import AnnouncementCreateScreen from "../screens/AnnouncementCreateScreen"
import PrayerManagementScreen from "../screens/PrayerManagementScreen"

const Stack = createNativeStackNavigator();



const AppNavigator = () => {

  return (

    <Stack.Navigator screenOptions={{

      headerShown: false,

      animation: 'fade',

      gestureEnabled: false,

    }}>

      <Stack.Screen name="Logo" component={LogoScreen} />

      <Stack.Screen name="Login" component={LoginScreen} />

      <Stack.Screen name="Register" component={RegisterScreen} />

      <Stack.Screen name = "Home" component= {HomeScreen} />

      <Stack.Screen name="Deen" component={DeenScreen} />

      <Stack.Screen name="Announcement" component={AnnouncementScreen} />

      <Stack.Screen name="Donation"     component={DonationScreen}     />

      <Stack.Screen name="Profile"     component={ProfileScreen}     />

      <Stack.Screen name="Editable" component={EditableOptionsScreen} />

      <Stack.Screen name="Qibla" component={QiblaScreen} />

      <Stack.Screen name="AnswerQA" component={ImamQAScreen} />

      <Stack.Screen name="QAViewer" component={QAViewerScreen} />

      <Stack.Screen name="AskQuestion" component={AskQuestionScreen} />

      <Stack.Screen name="ImamHadith" component={ImamHadithScreen} />

      <Stack.Screen name="HadithFeed" component={HadithFeedScreen} />

      <Stack.Screen name="Collector" component={CollectorScreen} />

      <Stack.Screen name="Chanda" component={ChandaHistoryScreen} />

      <Stack.Screen name="CollectorHistory" component={CollectorHistoryScreen} />

      <Stack.Screen name="Receipt" component={ReceiptScreen} />

      <Stack.Screen name="Prayer" component={PrayerScreen} />

      <Stack.Screen name="FamilyHistory" component={FamilyHistoryScreen} />

      <Stack.Screen name="HadithDetail" component={HadithDetailScreen} /> 

      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="ForceChangePassword" component={ForceChangePasswordScreen} />
      <Stack.Screen name="PendingApproval" component={PendingApprovalScreen} />
      <Stack.Screen name="CashSubmission" component={CashSubmissionScreen} />
      <Stack.Screen name="PostAnnouncement" component={AnnouncementCreateScreen} />
      <Stack.Screen name="PrayerTime" component={PrayerManagementScreen} />



    </Stack.Navigator>

  );

};



export default AppNavigator;