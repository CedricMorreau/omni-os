import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { usePairing } from '../pairing/PairingProvider';
import { ConnectScreen } from '../screens/ConnectScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ServersScreen } from '../screens/ServersScreen';
import { useOmniTheme } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors } = useOmniTheme();
  const { ready, servers } = usePairing();

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
      {servers.length > 0 ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="Servers"
            component={ServersScreen}
            options={{ title: 'Servers', headerBackTitle: 'Home' }}
          />
          <Stack.Screen
            name="AddServer"
            component={ConnectScreen}
            options={{ title: 'Add server', headerBackTitle: 'Back' }}
          />
        </>
      ) : (
        <Stack.Screen
          name="Connect"
          component={ConnectScreen}
          options={{ title: 'Connect to a server' }}
        />
      )}
    </Stack.Navigator>
  );
}
