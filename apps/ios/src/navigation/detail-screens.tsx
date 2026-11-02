import { StyleSheet, View } from 'react-native';

import { createNativeStackNavigator, type NativeStackNavigationOptions, type NativeStackNavigationProp } from '@react-navigation/native-stack';

import { HeaderButton } from '../components/HeaderButton';
import { ChannelScreen } from '../screens/ChannelScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { NewThreadScreen } from '../screens/NewThreadScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { NotificationsIntroScreen } from '../screens/NotificationsIntroScreen';
import { ServersScreen } from '../screens/ServersScreen';
import { ThreadScreen } from '../screens/ThreadScreen';
import { space, type ColorTokens } from '../theme';
import type { RootStackParamList } from './types';

export const Stack = createNativeStackNavigator<RootStackParamList>();

export function stackOptions(colors: ColorTokens): NativeStackNavigationOptions {
  return {
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.fg,
    headerTitleStyle: { color: colors.fg },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.bg },
  };
}

type Navigate = Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>;

export function serversButton(navigation: Navigate) {
  return () => <HeaderButton label="Servers" onPress={() => navigation.navigate('Servers')} />;
}

/** Servers and New on a tab's root, so a thread can start from any list. */
export function rootActions(navigation: Navigate) {
  return () => (
    <View style={styles.actions}>
      <HeaderButton label="Servers" onPress={() => navigation.navigate('Servers')} />
      <HeaderButton label="New" accessibilityLabel="New thread" onPress={() => navigation.navigate('NewThread')} />
    </View>
  );
}

/** The routes every tab can push, so `navigate('Thread', { id })` works from any tab and stays in it. */
export function detailScreens({ backTitle }: { backTitle: string }) {
  return (
    <>
      <Stack.Screen
        name="Channel"
        component={ChannelScreen}
        options={({ navigation, route }) => ({
          title: 'Channel',
          headerBackTitle: backTitle,
          headerRight: () => <HeaderButton label="New" accessibilityLabel="New thread" onPress={() => navigation.navigate('NewThread', { channel: route.params.id })} />,
        })}
      />
      <Stack.Screen name="NewThread" component={NewThreadScreen} options={{ title: 'New thread', presentation: 'modal' }} />
      <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Servers" component={ServersScreen} options={{ title: 'Servers', headerBackTitle: backTitle }} />
      <Stack.Screen name="AddServer" component={ConnectScreen} options={{ title: 'Add server', headerBackTitle: 'Back' }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
      <Stack.Screen name="NotificationsIntro" component={NotificationsIntroScreen} options={{ title: 'Notifications', presentation: 'modal' }} />
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s8,
  },
});
