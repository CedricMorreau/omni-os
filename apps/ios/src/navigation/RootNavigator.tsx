import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HeaderButton } from '../components/HeaderButton';
import { usePairing } from '../pairing/PairingProvider';
import { ChannelScreen } from '../screens/ChannelScreen';
import { ChannelsScreen } from '../screens/ChannelsScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { NotificationsIntroScreen } from '../screens/NotificationsIntroScreen';
import { ServersScreen } from '../screens/ServersScreen';
import { ThreadScreen } from '../screens/ThreadScreen';
import { useHasSession } from '../session/ActiveSession';
import { useOmniTheme } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** No session shows Connect alone. Any session makes Channels the home screen, with Servers one tap away. */
export function RootNavigator() {
  const { colors } = useOmniTheme();
  const { ready } = usePairing();
  const hasSession = useHasSession();

  if (!ready) return null;

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        headerTitleStyle: { color: colors.fg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {hasSession ? (
        <>
          <Stack.Screen
            name="Channels"
            component={ChannelsScreen}
            options={({ navigation }) => ({
              title: 'Channels',
              headerRight: () => <HeaderButton label="Servers" onPress={() => navigation.navigate('Servers')} />,
            })}
          />
          <Stack.Screen
            name="Channel"
            component={ChannelScreen}
            options={{ title: 'Channel', headerBackTitle: 'Channels' }}
          />
          <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
          <Stack.Screen
            name="Servers"
            component={ServersScreen}
            options={{ title: 'Servers', headerBackTitle: 'Channels' }}
          />
          <Stack.Screen
            name="AddServer"
            component={ConnectScreen}
            options={{ title: 'Add server', headerBackTitle: 'Back' }}
          />
          <Stack.Screen
            name="NotificationSettings"
            component={NotificationSettingsScreen}
            options={{ title: 'Notifications', headerBackTitle: 'Back' }}
          />
          <Stack.Screen
            name="NotificationsIntro"
            component={NotificationsIntroScreen}
            options={{ title: 'Notifications', presentation: 'modal' }}
          />
        </>
      ) : (
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect to a server' }} />
      )}
    </Stack.Navigator>
  );
}
