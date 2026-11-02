import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ChannelScreen } from '../screens/ChannelScreen';
import { ChannelsScreen } from '../screens/ChannelsScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ThreadScreen } from '../screens/ThreadScreen';
import { useOmniTheme } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors } = useOmniTheme();

  return (
    <Stack.Navigator
      initialRouteName="Channels"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        headerTitleStyle: { color: colors.fg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Connect"
        component={ConnectScreen}
        options={{ title: 'Connect', headerBackTitle: 'Home' }}
      />
      <Stack.Screen
        name="Channels"
        component={ChannelsScreen}
        options={{ title: 'Channels' }}
      />
      <Stack.Screen name="Channel" component={ChannelScreen} options={{ title: 'Channel', headerBackTitle: 'Channels' }} />
      <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
    </Stack.Navigator>
  );
}
