import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { HeaderButton } from '../components/HeaderButton';
import { usePairing } from '../pairing/PairingProvider';
import { ChannelScreen } from '../screens/ChannelScreen';
import { ChannelsScreen } from '../screens/ChannelsScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { ContinueScreen } from '../screens/ContinueScreen';
import { NewThreadScreen } from '../screens/NewThreadScreen';
import { ServersScreen } from '../screens/ServersScreen';
import { ThreadScreen } from '../screens/ThreadScreen';
import { useHasSession } from '../session/ActiveSession';
import { space, useOmniTheme } from '../theme';
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
              headerRight: () => (
                <View style={styles.actions}>
                  <HeaderButton label="Servers" onPress={() => navigation.navigate('Servers')} />
                  <HeaderButton label="New" accessibilityLabel="New thread" onPress={() => navigation.navigate('NewThread')} />
                </View>
              ),
            })}
          />
          <Stack.Screen
            name="Channel"
            component={ChannelScreen}
            options={({ navigation, route }) => ({
              title: 'Channel',
              headerBackTitle: 'Channels',
              headerRight: () => (
                <HeaderButton label="New" accessibilityLabel="New thread" onPress={() => navigation.navigate('NewThread', { channel: route.params.id })} />
              ),
            })}
          />
          <Stack.Screen name="NewThread" component={NewThreadScreen} options={{ title: 'New thread', presentation: 'modal' }} />
          <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
          <Stack.Screen name="Continue" component={ContinueScreen} options={{ title: 'Continue with another harness', presentation: 'modal' }} />
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
        </>
      ) : (
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect to a server' }} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: space.s8,
  },
});
