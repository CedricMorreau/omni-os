import { createNativeStackNavigator, type NativeStackNavigationOptions, type NativeStackNavigationProp } from '@react-navigation/native-stack';

import { HeaderButton } from '../components/HeaderButton';
import { ChannelScreen } from '../screens/ChannelScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
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
    headerLargeTitleStyle: { color: colors.fg },
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    contentStyle: { backgroundColor: colors.bg },
  };
}

export function serversButton(navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>) {
  return () => <HeaderButton label="Servers" onPress={() => navigation.navigate('Servers')} />;
}

/** The routes every tab can push, so `navigate('Thread', { id })` works from any tab and stays in it. */
export function detailScreens({ backTitle }: { backTitle: string }) {
  return (
    <>
      <Stack.Screen name="Channel" component={ChannelScreen} options={{ title: 'Channel', headerBackTitle: backTitle }} />
      <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Servers" component={ServersScreen} options={{ title: 'Servers', headerBackTitle: backTitle }} />
      <Stack.Screen name="AddServer" component={ConnectScreen} options={{ title: 'Add server', headerBackTitle: 'Back' }} />
    </>
  );
}
