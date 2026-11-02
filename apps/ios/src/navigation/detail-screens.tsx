import { createNativeStackNavigator, type NativeStackNavigationOptions, type NativeStackNavigationProp } from '@react-navigation/native-stack';

import { HeaderButton } from '../components/HeaderButton';
import { ArtifactScreen } from '../screens/ArtifactScreen';
import { AutomationsScreen } from '../screens/AutomationsScreen';
import { ChannelScreen } from '../screens/ChannelScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { DevicesScreen } from '../screens/DevicesScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ServersScreen } from '../screens/ServersScreen';
import { ThreadScreen } from '../screens/ThreadScreen';
import type { ColorTokens } from '../theme';
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

/** Search on the left and Settings on the right of a tab's root screen. Neither tab root has a back button to take the left. */
export function rootHeader(navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>) {
  return {
    headerLeft: () => <HeaderButton label="Search" onPress={() => navigation.navigate('Search')} />,
    headerRight: () => <HeaderButton label="Settings" onPress={() => navigation.navigate('Settings')} />,
  };
}

/** The routes every tab can push, so `navigate('Thread', { id })` works from any tab and stays in it. */
export function detailScreens({ backTitle }: { backTitle: string }) {
  return (
    <>
      <Stack.Screen name="Channel" component={ChannelScreen} options={{ title: 'Channel', headerBackTitle: backTitle }} />
      <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Artifact" component={ArtifactScreen} options={{ title: 'Artifact', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search', headerBackTitle: backTitle }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings', headerBackTitle: backTitle }} />
      <Stack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Devices', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="Automations" component={AutomationsScreen} options={{ title: 'Automations', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="Servers" component={ServersScreen} options={{ title: 'Servers', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="AddServer" component={ConnectScreen} options={{ title: 'Add server', headerBackTitle: 'Back' }} />
    </>
  );
}
